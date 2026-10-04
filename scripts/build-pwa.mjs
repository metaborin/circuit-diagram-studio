import { createHash } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('../dist/', import.meta.url))
async function files(directory) {
  const found = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = path.join(directory, entry.name)
    if (entry.isDirectory()) found.push(...await files(name))
    else if (entry.isFile() && entry.name !== 'sw.js') found.push(name)
  }
  return found
}
const assets = (await files(root)).sort()
const digest = createHash('sha256')
for (const asset of assets) digest.update(path.relative(root, asset).replaceAll('\\', '/')).update(await readFile(asset))
const template = await readFile(new URL('./service-worker.template.js', import.meta.url), 'utf8')
// A worker behavior change is a new version even when the application assets are unchanged.
digest.update(template)
const version = digest.digest('hex').slice(0, 20)
const urls = assets.map(asset => '/circuit-diagram-studio/' + path.relative(root, asset).replaceAll('\\', '/'))
if (!urls.includes('/circuit-diagram-studio/index.html')) throw new Error('Built index.html is missing')
await writeFile(path.join(root, 'sw.js'), template
  .replace("'__BUILD_VERSION__'", JSON.stringify(version))
  .replace('/*__PRECACHE__*/ []', JSON.stringify(urls)))
console.log(`PWA: ${urls.length} assets, cache metaborin/circuit-diagram-studio/${version}`)
