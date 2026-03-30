import Fastify from 'fastify'

const server = Fastify({ logger: true })

server.get('/', async () => ({ status: 'claude-agent-ui server' }))

const port = parseInt(process.env.PORT ?? '3456')
server.listen({ port, host: '0.0.0.0' }, (err) => {
  if (err) { server.log.error(err); process.exit(1) }
  server.log.info(`Server running on port ${port}`)
})
