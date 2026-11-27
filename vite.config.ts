import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { brotliCompress, constants, gzip } from 'node:zlib'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const compressBrotli = promisify(brotliCompress)
const compressGzip = promisify(gzip)
const precompressedAssets: Plugin = {
  name: 'precompressed-assets',
  apply: 'build',
  generateBundle: {
    order: 'post',
    async handler(_options, bundle) {
      await Promise.all(Object.values(bundle).map(async file => {
        if (!/\.(?:js|css)$/.test(file.fileName)) return
        const output = file.type === 'chunk' ? file.code : file.source
        const source = typeof output === 'string' ? Buffer.from(output) : output
        if (source.length < 1024) return
        const [brotli, gzipData] = await Promise.all([
          compressBrotli(source, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } }),
          compressGzip(source),
        ])
        if (brotli.length < source.length) this.emitFile({ type: 'asset', fileName: file.fileName + '.br', source: brotli })
        if (gzipData.length < source.length) this.emitFile({ type: 'asset', fileName: file.fileName + '.gz', source: gzipData })
      }))
    },
  },
}

export default defineConfig({
  root: fileURLToPath(new URL('./frontend', import.meta.url)),
  plugins: [react(), tailwindcss(), precompressedAssets],
  css: { preprocessorMaxWorkers: 0 },
  resolve: { alias: { '@': fileURLToPath(new URL('./frontend/src', import.meta.url)) } },
  build: { outDir: '../dist', emptyOutDir: true },
})
