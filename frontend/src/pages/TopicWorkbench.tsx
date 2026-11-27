import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { SelectControl, SelectOption } from '@/components/ui/select'
import { Empty, ExternalLink, Heading, Panel } from '@/components/common'
import { useResource } from '@/hooks/use-resource'
import { errorMessage, getEpisodeOptions, getFeedbackTopics, linkFeedbackTopic } from '@/lib/api'
import { episodeHref } from '@/lib/format'

export function TopicWorkbench() {
  const episodeOptions = useResource(getEpisodeOptions, 60_000)
  const episodesById = useMemo(() => new Map(episodeOptions.data?.map(episode => [episode.id, episode])), [episodeOptions.data])
  const options = useMemo(() => episodeOptions.data?.map(episode => <SelectOption key={episode.id} value={episode.id}>{episode.name}</SelectOption>), [episodeOptions.data])
  const { data, error, refresh } = useResource(getFeedbackTopics, 30000)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  async function link(commentId: string, episodeId: string) {
    setSaving(true)
    setMessage('')
    try {
      await linkFeedbackTopic(commentId, episodeId || null)
      await refresh()
    } catch (e) {
      setMessage(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return <>
    <Heading title="选题工作台">回看保存的评论，为每条选题关联一期作品。</Heading>
    <Button asChild variant="outline" size="sm" className="mb-4"><a href="#/feedback">前往评论反馈</a></Button>
    {(message || error || episodeOptions.error) && <p role="alert" className="mb-4 text-sm text-destructive">{message || error || episodeOptions.error}</p>}
    {data?.length ? <div className="space-y-3">{data.map(topic => {
      const episode = topic.episodeId ? episodesById.get(topic.episodeId) : undefined
      return <Panel key={topic.commentId}>
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,16rem)]">
          <div className="min-w-0 space-y-2">
            <p className="text-xs text-muted-foreground">
              {topic.platformName} · {topic.sourceEpisodeName} · {topic.author || '匿名'}
              {topic.url && <> · <ExternalLink url={topic.url}>原评论 ↗</ExternalLink></>}
            </p>
            <p className="whitespace-pre-wrap break-words text-sm leading-6">{topic.content}</p>
          </div>
          <div className="space-y-2">
            <p className="text-xs font-medium">关联作品</p>
            <SelectControl label="关联作品" className="w-full" value={topic.episodeId ?? ''} disabled={saving || !episodeOptions.data} onValueChange={value => void link(topic.commentId, value)}>
              <SelectOption value="">未关联</SelectOption>
              {topic.episodeId && !episode && <SelectOption value={topic.episodeId} disabled>{episodeOptions.data || episodeOptions.error ? '关联作品不可用' : '正在读取关联作品…'}</SelectOption>}
              {options}
            </SelectControl>
            {episode && <a href={episodeHref(episode)} className="text-xs text-primary hover:underline">查看作品档案</a>}
          </div>
        </div>
      </Panel>
    })}</div> : <Panel><Empty>{data ? '还没有选题。可以从评论明细保存一条。' : error ? '选题暂时无法加载' : '正在加载选题…'}</Empty></Panel>}
  </>
}
