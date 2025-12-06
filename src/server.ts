import express from 'express'
const app = express()
app.get('/healthz', (_req: any, res: any) => res.json({ ok: true }))
app.listen(3000, () => console.log('API on :3000'))
