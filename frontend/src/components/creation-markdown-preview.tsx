import MarkdownIt, { type Env } from 'markdown-it'
import './creation-markdown.css'

const markdown = new MarkdownIt({ html: false })
export type MarkdownAsset = { markdownPath?: string; url: string }
type MarkdownEnvironment = Env & { assetUrls: ReadonlyMap<string, string> }

const renderImage = markdown.renderer.rules.image
markdown.renderer.rules.image = (tokens, index, options, env, renderer) => {
  const token = tokens[index]
  const url = (env as MarkdownEnvironment | undefined)?.assetUrls.get(String(token.attrGet('src') ?? ''))
  if (url) token.attrSet('src', url)
  token.attrSet('loading', 'lazy')
  token.attrSet('decoding', 'async')
  return renderImage?.(tokens, index, options, env, renderer) ?? renderer.renderToken(tokens, index, options)
}

markdown.renderer.rules.link_open = (tokens, index, options, env, renderer) => {
  const token = tokens[index]
  const href = String(token.attrGet('href') ?? '')
  const url = (env as MarkdownEnvironment | undefined)?.assetUrls.get(href)
  if (url) token.attrSet('href', url)
  if (href && !href.startsWith('#')) {
    token.attrSet('target', '_blank')
    token.attrSet('rel', 'noopener noreferrer')
  }
  return renderer.renderToken(tokens, index, options)
}

export default function CreationMarkdownPreview({ source, assets = [] }: { source: string; assets?: readonly MarkdownAsset[] }) {
  const assetUrls = new Map(assets.flatMap(asset => asset.markdownPath ? [[asset.markdownPath, asset.url] as const] : []))
  return <div className="creation-markdown" dangerouslySetInnerHTML={{ __html: markdown.render(source, { assetUrls }) }} />
}
