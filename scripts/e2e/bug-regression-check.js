const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function loadPlaywright() {
  for (const moduleName of ['playwright-core', 'playwright']) {
    try {
      return require(moduleName);
    } catch {
      continue;
    }
  }

  throw new Error(
    'Missing Playwright runtime. Install `playwright-core` (preferred) or `playwright` before running this script.'
  );
}

const { chromium } = loadPlaywright();

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:5173';
const PROJECT_CWD = process.env.PROJECT_CWD || REPO_ROOT;
const OUTPUT_PATH =
  process.env.OUTPUT_PATH ||
  path.join(os.tmpdir(), 'claude-agent-ui-playwright', 'bug-regression-result.json');
const HEADLESS = process.env.HEADLESS !== 'false';
const DEFAULT_BROWSER_PATHS = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean);

function resolveBrowserExecutable() {
  return DEFAULT_BROWSER_PATHS.find((candidate) => fs.existsSync(candidate));
}

async function createContext(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  await context.addInitScript(() => {
    const sent = [];
    const received = [];
    const instances = [];
    const NativeWebSocket = window.WebSocket;

    function record(list, raw) {
      try {
        list.push(JSON.parse(raw));
      } catch {
        list.push({ __raw: String(raw) });
      }
    }

    function RecorderWebSocket(...args) {
      const ws = new NativeWebSocket(...args);
      instances.push(ws);
      ws.addEventListener('message', (event) => record(received, event.data));
      const originalSend = ws.send;
      ws.send = function patchedSend(data) {
        record(sent, data);
        return originalSend.call(this, data);
      };
      return ws;
    }

    RecorderWebSocket.prototype = NativeWebSocket.prototype;
    Object.setPrototypeOf(RecorderWebSocket, NativeWebSocket);
    for (const key of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) {
      RecorderWebSocket[key] = NativeWebSocket[key];
    }

    window.WebSocket = RecorderWebSocket;
    window.__wsRecorder = { sent, received, instances };
  });
  return context;
}

function attachErrorCollectors(page, label, pageErrors, consoleErrors) {
  page.on('pageerror', (err) => {
    pageErrors.push(`${label}: ${err.message}`);
  });

  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (text.includes('Failed to load resource') && text.includes('404')) return;
    if (label === 'disconnect' && text.includes('ERR_INTERNET_DISCONNECTED')) return;
    consoleErrors.push(`${label}: ${text}`);
  });
}

async function openNewConversation(page, sessionName) {
  const url = `${BASE_URL}/?cwd=${encodeURIComponent(PROJECT_CWD)}&sessionName=${encodeURIComponent(sessionName)}`;
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.locator('button').nth(0).click();
  await page.getByRole('button', { name: /claude-agent-ui/i }).click();
  await page.locator('textarea[data-composer]').waitFor({ state: 'visible', timeout: 20000 });
}

async function getWsRecords(page) {
  return page.evaluate(() => window.__wsRecorder);
}

async function waitForPendingIds(page, sessionId, ids) {
  await page.waitForFunction(
    ({ targetSessionId, targetIds }) => {
      const records = window.__wsRecorder;
      if (!records) return false;
      const latestPending = [...records.received]
        .reverse()
        .find((msg) => msg && msg.type === 'local-pending-sync' && msg.sessionId === targetSessionId);
      if (!latestPending || !Array.isArray(latestPending.items)) return false;
      return targetIds.every((id) =>
        latestPending.items.some((item) => item.id === id && item.status === 'pending')
      );
    },
    { targetSessionId: sessionId, targetIds: ids },
    { timeout: 10000 }
  );
}

function findSentMessage(records, prompt) {
  return [...records.sent]
    .reverse()
    .find((msg) => msg && msg.type === 'send-message' && msg.prompt === prompt);
}

function extractAssistantTexts(records) {
  const texts = [];
  for (const entry of records.received) {
    if (!entry || entry.type !== 'agent-message') continue;
    const agentMessage = entry.message;
    if (!agentMessage || agentMessage.type !== 'assistant') continue;
    const content = agentMessage.message?.content;
    if (typeof content === 'string') {
      texts.push(content);
      continue;
    }
    if (!Array.isArray(content)) continue;
    const joined = content
      .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join(' ');
    if (joined) texts.push(joined);
  }
  return texts;
}

function getLatestPendingSnapshot(records, sessionId) {
  return (
    [...records.received]
      .reverse()
      .find((msg) => msg && msg.type === 'local-pending-sync' && msg.sessionId === sessionId) || null
  );
}

async function runIdleScenario(browser, stamp, pageErrors, consoleErrors) {
  const context = await createContext(browser);
  const page = await context.newPage();
  attachErrorCollectors(page, 'idle', pageErrors, consoleErrors);

  const sessionName = `pw-idle-first-send-${stamp}`;
  const prompt = `PW_IDLE_FIRST_SEND_${stamp}: reply with exactly OK.`;

  try {
    await openNewConversation(page, sessionName);

    const composer = page.locator('textarea[data-composer]');
    await composer.fill(prompt);
    await composer.press('Enter');

    await page.getByText(prompt, { exact: true }).waitFor({ state: 'visible', timeout: 20000 });
    await page.waitForTimeout(2500);

    const pendingVisible = (await page.getByText(/^Pending$/).count()) > 0;
    const records = await getWsRecords(page);
    const sent = findSentMessage(records, prompt);
    const syncContainingPromptId = Boolean(
      sent &&
        records.received.some(
          (msg) =>
            msg &&
            msg.type === 'local-pending-sync' &&
            Array.isArray(msg.items) &&
            msg.items.some((item) => item.id === sent.clientMessageId)
        )
    );
    const userAckReceived = Boolean(
      sent &&
        records.received.some(
          (msg) =>
            msg &&
            msg.type === 'agent-message' &&
            msg.message?.type === 'user' &&
            msg.message?.uuid === sent.clientMessageId
        )
    );

    return {
      sessionName,
      prompt,
      clientMessageId: sent?.clientMessageId ?? null,
      pendingVisible,
      syncContainingPromptId,
      userAckReceived,
    };
  } finally {
    await context.close();
  }
}

async function runInterruptScenario(browser, stamp, pageErrors, consoleErrors) {
  const context = await createContext(browser);
  const page = await context.newPage();
  attachErrorCollectors(page, 'interrupt', pageErrors, consoleErrors);

  const sessionName = `pw-interrupt-queue-${stamp}`;
  const firstPrompt = [
    `PW_INTERRUPT_BASE_${stamp}.`,
    'Inspect this repository deeply.',
    'Read at least 30 TypeScript or TSX files across packages/server, packages/web, and packages/shared.',
    'Produce a structured report with architecture notes, websocket flow, and local pending behavior.',
    'Do not ask follow-up questions.',
  ].join(' ');
  const message1 = `Please mention token MIDTURN_ONE_${stamp} verbatim in your next response if you receive this.`;
  const message2 = `Please mention token MIDTURN_TWO_${stamp} verbatim in your next response if you receive this.`;

  try {
    await openNewConversation(page, sessionName);

    const composer = page.locator('textarea[data-composer]');
    await composer.fill(firstPrompt);
    await composer.press('Enter');

    await page.getByText(firstPrompt, { exact: true }).waitFor({ state: 'visible', timeout: 20000 });
    await page.locator('button[title="Stop"]').waitFor({ state: 'visible', timeout: 20000 });

    await composer.fill(message1);
    await composer.press('Enter');
    await composer.fill(message2);
    await composer.press('Enter');

    const recordsBeforeEsc = await getWsRecords(page);
    const sent1BeforeEsc = findSentMessage(recordsBeforeEsc, message1);
    const sent2BeforeEsc = findSentMessage(recordsBeforeEsc, message2);
    const sessionIdBeforeEsc =
      sent1BeforeEsc?.sessionId || sent2BeforeEsc?.sessionId || null;

    if (!sent1BeforeEsc?.clientMessageId || !sent2BeforeEsc?.clientMessageId || !sessionIdBeforeEsc) {
      throw new Error('Failed to capture both mid-turn submissions before interrupt.');
    }

    await waitForPendingIds(page, sessionIdBeforeEsc, [
      sent1BeforeEsc.clientMessageId,
      sent2BeforeEsc.clientMessageId,
    ]);

    const refreshedRecordsBeforeEsc = await getWsRecords(page);
    const latestPendingBeforeEsc = getLatestPendingSnapshot(refreshedRecordsBeforeEsc, sessionIdBeforeEsc);
    const pendingBeforeEsc = Array.isArray(latestPendingBeforeEsc?.items)
      ? latestPendingBeforeEsc.items.filter((item) => item.status === 'pending').length
      : 0;

    await composer.press('Escape');
    await page.locator('button[title="Interrupting..."]').waitFor({ state: 'visible', timeout: 5000 });
    await page.waitForTimeout(15000);

    const records = await getWsRecords(page);
    const sent1 = findSentMessage(records, message1);
    const sent2 = findSentMessage(records, message2);
    const sessionId = sent1?.sessionId || sent2?.sessionId || null;

    const userAcks = records.received
      .filter((msg) => msg && msg.type === 'agent-message' && msg.message?.type === 'user')
      .map((msg) => msg.message.uuid);

    const latestPending = sessionId ? getLatestPendingSnapshot(records, sessionId) : null;
    const pendingItems = Array.isArray(latestPending?.items) ? latestPending.items : [];
    const pendingIds = pendingItems.filter((item) => item.status === 'pending').map((item) => item.id);
    const failedIds = pendingItems.filter((item) => item.status === 'failed').map((item) => item.id);

    const ack1 = Boolean(sent1 && userAcks.includes(sent1.clientMessageId));
    const ack2 = Boolean(sent2 && userAcks.includes(sent2.clientMessageId));
    const msg1StillPending = Boolean(sent1 && pendingIds.includes(sent1.clientMessageId));
    const msg2StillPending = Boolean(sent2 && pendingIds.includes(sent2.clientMessageId));
    const msg1Failed = Boolean(sent1 && failedIds.includes(sent1.clientMessageId));
    const msg2Failed = Boolean(sent2 && failedIds.includes(sent2.clientMessageId));

    const assistantTexts = extractAssistantTexts(records);
    const assistantMentionsBoth = assistantTexts.some(
      (text) => text.includes(`MIDTURN_ONE_${stamp}`) && text.includes(`MIDTURN_TWO_${stamp}`)
    );

    const inconsistentPartialAck = (ack1 && msg2StillPending) || (ack2 && msg1StillPending);

    return {
      sessionName,
      firstPrompt,
      message1,
      message2,
      sessionId,
      clientMessageId1: sent1?.clientMessageId ?? null,
      clientMessageId2: sent2?.clientMessageId ?? null,
      pendingBeforeEsc,
      ack1,
      ack2,
      msg1StillPending,
      msg2StillPending,
      msg1Failed,
      msg2Failed,
      assistantMentionsBoth,
      assistantTexts,
      inconsistentPartialAck,
    };
  } finally {
    await context.close();
  }
}

async function runDisconnectedSendScenario(browser, stamp, pageErrors, consoleErrors) {
  const context = await createContext(browser);
  const page = await context.newPage();
  attachErrorCollectors(page, 'disconnect', pageErrors, consoleErrors);

  const sessionName = `pw-disconnected-send-${stamp}`;
  const prompt = `PW_DISCONNECTED_SEND_${stamp}: this should stay local.`;

  try {
    await openNewConversation(page, sessionName);

    const composer = page.locator('textarea[data-composer]');
    await context.setOffline(true);
    await page.evaluate(() => {
      const instances = window.__wsRecorder?.instances ?? [];
      const ws = instances[instances.length - 1];
      if (ws) ws.close();
    });

    await page.waitForFunction(
      () => {
        const text = document.body.innerText;
        return text.includes('Connection lost. Reconnecting...')
          || text.includes('Disconnected from server')
          || text.includes('Connecting...');
      },
      { timeout: 20000 }
    );

    await composer.fill(prompt);
    await composer.press('Enter');
    await page.getByText('Not connected to server. Message was not sent.').waitFor({
      state: 'visible',
      timeout: 10000,
    });
    await page.waitForTimeout(500);

    const textareaValue = await composer.inputValue();
    const records = await getWsRecords(page);
    const sendAttemptRecorded = records.sent.some(
      (msg) => msg && msg.type === 'send-message' && msg.prompt === prompt
    );
    const latestPending = [...records.received]
      .reverse()
      .find((msg) => msg && msg.type === 'local-pending-sync');
    const promptPending = Boolean(
      latestPending
      && Array.isArray(latestPending.items)
      && latestPending.items.some((item) => item.value === prompt)
    );

    return {
      sessionName,
      prompt,
      textareaPreserved: textareaValue === prompt,
      toastVisible: true,
      sendAttemptRecorded,
      promptPending,
    };
  } finally {
    await context.close();
  }
}

async function main() {
  const executablePath = resolveBrowserExecutable();
  const browser = await chromium.launch({
    headless: HEADLESS,
    executablePath,
  });

  const pageErrors = [];
  const consoleErrors = [];
  const stamp = Date.now();
  let idle = null;
  let interrupt = null;
  let disconnect = null;
  let result;

  try {
    idle = await runIdleScenario(browser, stamp, pageErrors, consoleErrors);
    interrupt = await runInterruptScenario(browser, stamp, pageErrors, consoleErrors);
    disconnect = await runDisconnectedSendScenario(browser, stamp, pageErrors, consoleErrors);

    result = {
      idle,
      interrupt,
      disconnect,
      pageErrors,
      consoleErrors,
    };
  } finally {
    await browser.close();
  }

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, outputPath: OUTPUT_PATH }, null, 2));

  const failed = [
    idle?.pendingVisible,
    idle?.syncContainingPromptId,
    interrupt?.inconsistentPartialAck,
    interrupt?.assistantMentionsBoth,
    !disconnect?.textareaPreserved,
    disconnect?.sendAttemptRecorded,
    disconnect?.promptPending,
    pageErrors.length > 0,
    consoleErrors.length > 0,
  ].some(Boolean);

  if (failed) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
