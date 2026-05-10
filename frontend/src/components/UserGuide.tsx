import { Spin } from 'antd'
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

const UserGuide: React.FC = () => {
  const { i18n } = useTranslation()
  const [content, setContent] = useState<string | null>(null)

  useEffect(() => {
    const lang = i18n.language.startsWith('zh') ? 'zh' : 'en'
    setContent(null)
    fetch(`/guide/${lang}.md`)
      .then((res) => res.text())
      .then(setContent)
      .catch(() => setContent(''))
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
      {content === null ? (
        <Spin style={{ display: 'block', marginTop: 40 }} />
      ) : (
        <div className="ai-message-content user-guide-content">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        </div>
      )}
    </div>
  )
}

export default UserGuide
