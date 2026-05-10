import { Spin, Typography } from 'antd'
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

const UserGuide: React.FC = () => {
  const { i18n, t } = useTranslation()
  const [content, setContent] = useState<string | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    const lang = i18n.language.startsWith('zh') ? 'zh' : 'en'
    setContent(null)
    setError(false)
    fetch(`/guide/${lang}.md`)
      .then((res) => {
        if (!res.ok) throw new Error(res.statusText)
        return res.text()
      })
      .then(setContent)
      .catch(() => setError(true))
  }, [i18n.language])

  return (
    <div
      style={{
        padding: '16px 24px',
        maxWidth: 960,
        margin: '0 auto',
        overflowY: 'auto',
        height: '100%',
      }}
    >
      {content === null && !error ? (
        <Spin style={{ display: 'block', marginTop: 40 }} />
      ) : error ? (
        <Typography.Text type="danger">{t('parseError')}</Typography.Text>
      ) : (
        <div className="ai-message-content user-guide-content">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content!}</ReactMarkdown>
        </div>
      )}
    </div>
  )
}

export default UserGuide
