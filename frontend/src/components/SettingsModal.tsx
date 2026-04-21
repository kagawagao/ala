import React, { useState, useEffect } from 'react'
import {
  Modal,
  Form,
  Input,
  Slider,
  Button,
  App,
  Typography,
  Tag,
  Divider,
  Select,
  InputNumber,
} from 'antd'
import { useTranslation } from 'react-i18next'
import { getConfig, updateConfig } from '../api/config'
import type { AIConfig } from '../types'

const { Text } = Typography

interface SettingsModalProps {
  open: boolean
  onClose: () => void
  onConfigSaved: () => void
  backendConnected: boolean
}

const SettingsModal: React.FC<SettingsModalProps> = ({
  open,
  onClose,
  onConfigSaved,
  backendConnected,
}) => {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const [form] = Form.useForm<AIConfig>()
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open && backendConnected) {
      getConfig()
        .then((cfg) => form.setFieldsValue(cfg))
        .catch(() => {
          const saved = localStorage.getItem('aiConfig')
          if (saved) {
            try {
              form.setFieldsValue(JSON.parse(saved) as AIConfig)
            } catch {
              /* ignore */
            }
          }
        })
    }
  }, [open, backendConnected, form])

  const handleSave = async () => {
    try {
      const values = await form.validateFields()
      setSaving(true)
      localStorage.setItem('aiConfig', JSON.stringify(values))
      if (backendConnected) {
        await updateConfig(values)
      }
      void message.success(t('aiSettingsSaved'))
      onConfigSaved()
      onClose()
    } catch (err: unknown) {
      if (err instanceof Error) {
        void message.error(err.message)
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title={t('settings')}
      open={open}
      onCancel={onClose}
      footer={[
        <Button key="cancel" onClick={onClose}>
          {t('cancel')}
        </Button>,
        <Button
          key="save"
          type="primary"
          loading={saving}
          onClick={() => {
            void handleSave()
          }}
        >
          {t('save')}
        </Button>,
      ]}
      width={520}
    >
      <div style={{ marginBottom: 12 }}>
        <Text type="secondary" style={{ fontSize: 12 }}>
          Backend:{' '}
        </Text>
        <Tag color={backendConnected ? 'success' : 'error'}>
          {backendConnected ? t('connected') : t('disconnected')}
        </Tag>
        {!backendConnected && (
          <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 4 }}>
            {t('backendNotConnected')}
          </Text>
        )}
      </div>

      <Divider titlePlacement="left" style={{ fontSize: 13 }}>
        {t('aiSettings')}
      </Divider>

      <Form form={form} layout="vertical" size="middle">
        <Form.Item
          label={t('apiEndpoint')}
          name="api_endpoint"
          rules={[{ required: true, message: 'Please enter API endpoint' }]}
          initialValue="https://api.anthropic.com"
        >
          <Input placeholder="https://api.anthropic.com" />
        </Form.Item>
        <Form.Item
          label={t('apiKey')}
          name="api_key"
          rules={[{ required: true, message: 'Please enter API key' }]}
        >
          <Input.Password placeholder="sk-ant-..." />
        </Form.Item>
        <Form.Item
          label={t('model')}
          name="model"
          rules={[{ required: true, message: 'Please enter model name' }]}
          initialValue="claude-sonnet-4-20250514"
        >
          <Input placeholder="claude-sonnet-4-20250514" />
        </Form.Item>
        <Form.Item label={t('temperature')} name="temperature" initialValue={0.7}>
          <Slider min={0} max={2} step={0.1} marks={{ 0: '0', 1: '1', 2: '2' }} />
        </Form.Item>

        <Divider titlePlacement="left" style={{ fontSize: 12, margin: '12px 0' }}>
          {t('thinkingMode')}
        </Divider>

        <Form.Item label={t('thinkingMode')} name="thinking_mode" initialValue="off">
          <Select
            options={[
              { value: 'off', label: t('thinkingOff') },
              { value: 'auto', label: t('thinkingAuto') },
              { value: 'on', label: t('thinkingOn') },
            ]}
          />
        </Form.Item>
        <Form.Item label={t('thinkingBudget')} name="thinking_budget_tokens" initialValue={8000}>
          <InputNumber min={1024} max={32000} step={1024} style={{ width: '100%' }} />
        </Form.Item>
      </Form>
    </Modal>
  )
}

export default SettingsModal
