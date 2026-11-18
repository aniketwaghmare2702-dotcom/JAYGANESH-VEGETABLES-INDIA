// Netlify Server entry point for the JAY GANESH website + POS backend.
//
// The backend (backend/server.mjs) uses a local SQLite database. Netlify Server
// instances have no persistent disk, so the database file and its field
// encryption key are restored from Netlify Blobs on cold start and a fresh
// snapshot is saved back to Blobs after every request that changes data.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { getStore } from '@netlify/blobs'
import { getContext, onShutdown } from '@netlify/server'
import pages from './pages.generated.mjs'

const runtimeDir = path.join(os.tmpdir(), 'jay-ganesh')
const dataDir = path.join(runtimeDir, 'data')
const frontendDir = path.join(runtimeDir, 'frontend')
const dbFile = 'jay-ganesh-pos.sqlite'
const keyFile = 'field-encryption.key'
const store = getStore({ name: 'jay-ganesh-pos', consistency: 'strong' })

fs.mkdirSync(dataDir, { recursive: true })
fs.mkdirSync(frontendDir, { recursive: true })
for (const [name, html] of Object.entries(pages)) fs.writeFileSync(path.join(frontendDir, name), html)

// Restore the encryption key first: encrypted columns are unreadable without it.
const savedKey = await store.get(keyFile, { type: 'arrayBuffer' })
if (savedKey) fs.writeFileSync(path.join(dataDir, keyFile), Buffer.from(savedKey), { mode: 0o600 })
const savedDb = await store.get(dbFile, { type: 'arrayBuffer' })
if (savedDb) fs.writeFileSync(path.join(dataDir, dbFile), Buffer.from(savedDb))
if (savedDb && !savedKey) console.warn('Database snapshot found without its encryption key; encrypted fields cannot be read.')

process.env.DATA_DIR = dataDir
process.env.FRONTEND_DIR = frontendDir
process.env.JG_EXTERNAL_SERVER = '1'
process.env.POS_COOKIE_SECURE ??= '1'
if (!process.env.POS_PUBLIC_URL && process.env.URL) process.env.POS_PUBLIC_URL = process.env.URL

const { server, database } = await import('../../backend/server.mjs')

// The backend creates the key on first run; persist it once.
if (!savedKey) await store.set(keyFile, fs.readFileSync(path.join(dataDir, keyFile)))

let saving = Promise.resolve()
let dirty = false
function saveSnapshot() {
  dirty = true
  saving = saving.then(async () => {
    if (!dirty) return
    dirty = false
    try {
      database.exec('PRAGMA wal_checkpoint(TRUNCATE)')
      await store.set(dbFile, fs.readFileSync(path.join(dataDir, dbFile)))
    } catch (e) {
      dirty = true
      console.error('Saving database snapshot failed:', e.message)
    }
  })
  return saving
}
if (!savedDb) await saveSnapshot()

const readOnly = new Set(['GET', 'HEAD', 'OPTIONS'])
server.prependListener('request', (req, res) => {
  const context = getContext()
  // Behind Netlify's proxy the socket address is the proxy; use the visitor's IP for rate limits.
  if (context?.ip) req.jgClientIp = context.ip
  if (readOnly.has(req.method)) return
  res.on('finish', () => {
    try {
      context.waitUntil(saveSnapshot())
    } catch {
      saveSnapshot()
    }
  })
})

onShutdown(async ({ drained }) => {
  await drained
  await saveSnapshot()
})

export default server

// One instance only: every instance holds its own copy of the SQLite file, so
// more than one would overwrite each other's snapshots.
export const config = { scale: { max: 1 } }
