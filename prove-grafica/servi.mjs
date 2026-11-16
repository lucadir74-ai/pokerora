// Piccolo server locale solo per guardare le prove di grafica (non fa parte dell'app)
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const pagina = fileURLToPath(new URL('./index.html', import.meta.url))
createServer(async (_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(await readFile(pagina))
}).listen(5199, '127.0.0.1', () => console.log('Prove di grafica: http://localhost:5199'))
