import type { SdkFeatureStatus } from './management.js'

export const SDK_FEATURES: SdkFeatureStatus[] = [
  {
    name: 'canUseTool',
    sdkVersion: '0.1.0',
    uiSupported: true,
    description: '工具审批：Agent 请求使用工具时，用户可批准或拒绝',
    category: 'feature',
  },
  {
    name: 'canUseTool.updatedInput',
    sdkVersion: '0.2.50',
    uiSupported: true,
    description: '工具审批时支持修改输入参数后继续执行',
    category: 'feature',
  },
  {
    name: 'askUser',
    sdkVersion: '0.1.0',
    uiSupported: true,
    description: 'Agent 向用户提问，支持多选和自由文本',
    category: 'feature',
  },
  {
    name: 'resume',
    sdkVersion: '0.2.0',
    uiSupported: true,
    description: '恢复已有会话继续对话',
    category: 'api',
  },
  {
    name: 'subAgents',
    sdkVersion: '0.2.60',
    uiSupported: true,
    description: '子 Agent 可视化',
    category: 'feature',
  },
  {
    name: 'taskProgress',
    sdkVersion: '0.2.70',
    uiSupported: true,
    description: 'Task 进度卡片',
    category: 'feature',
  },
  {
    name: 'fileCheckpoint',
    sdkVersion: '0.2.80',
    uiSupported: true,
    description: '文件检查点回滚',
    category: 'feature',
  },
]
