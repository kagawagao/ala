import { Card, List, Space, Typography } from 'antd'
import React from 'react'
import { useTranslation } from 'react-i18next'

const UserGuide: React.FC = () => {
  const { t } = useTranslation()

  const quickStartItems = [
    t('guideQuickStartItem1'),
    t('guideQuickStartItem2'),
    t('guideQuickStartItem3'),
    t('guideQuickStartItem4'),
  ]
  const aiAssistantItems = [t('guideAiItem1'), t('guideAiItem2'), t('guideAiItem3')]
  const tipsItems = [t('guideTipsItem1'), t('guideTipsItem2'), t('guideTipsItem3')]

  return (
    <div style={{ padding: 16, maxWidth: 960, margin: '0 auto' }}>
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Typography.Title level={2} style={{ margin: 0 }}>
          {t('userGuide')}
        </Typography.Title>
        <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
          {t('userGuideDescription')}
        </Typography.Paragraph>

        <Card title={t('guideQuickStart')}>
          <List
            dataSource={quickStartItems}
            renderItem={(item) => (
              <List.Item>
                <Typography.Text>{item}</Typography.Text>
              </List.Item>
            )}
          />
        </Card>

        <Card title={t('guideAiAssistant')}>
          <List
            dataSource={aiAssistantItems}
            renderItem={(item) => (
              <List.Item>
                <Typography.Text>{item}</Typography.Text>
              </List.Item>
            )}
          />
        </Card>

        <Card title={t('guideTips')}>
          <List
            dataSource={tipsItems}
            renderItem={(item) => (
              <List.Item>
                <Typography.Text>{item}</Typography.Text>
              </List.Item>
            )}
          />
        </Card>
      </Space>
    </div>
  )
}

export default UserGuide
