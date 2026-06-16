import { Spin, Typography } from 'antd'
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

// Module-level cache so the same language file is only fetched once per session
const guideCache = new Map<string, string>()

const GuidePage: React.FC = () => {
  const { i18n, t } = useTranslation()
  const [content, setContent] = useState<string | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    const lang = i18n.language.startsWith('zh') ? 'zh' : 'en'

    // Serve from cache immediately if available
    if (guideCache.has(lang)) {
      setContent(guideCache.get(lang)!)
      setError(false)
      return
    }

    setContent(null)
    setError(false)

    const controller = new AbortController()
    fetch(`/guide/${lang}.md`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(res.statusText)
        return res.text()
      })
      .then((text) => {
        guideCache.set(lang, text)
        setContent(text)
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name !== 'AbortError') {
          setError(true)
        }
      })

    return () => controller.abort()
  }, [i18n.language])

  return (
    <div
      style={{
        padding: '16px 24px',
        maxWidth: 960,
        margin: '0 auto',
      }}
    >
      {content === null && !error ? (
        <Spin style={{ display: 'block', marginTop: 40 }} />
      ) : error ? (
        <Typography.Text type="danger">{t('guideLoadError')}</Typography.Text>
      ) : (
        <div className="ai-message-content user-guide-content">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content!}</ReactMarkdown>
        </div>
      )}
    </div>
  )
}

export default GuidePage
