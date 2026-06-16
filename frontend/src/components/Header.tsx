import {
  AppstoreOutlined,
  ArrowLeftOutlined,
  BookOutlined,
  CodeOutlined,
  DisconnectOutlined,
  FolderOutlined,
  GlobalOutlined,
  MoonOutlined,
  ReloadOutlined,
  SunOutlined,
  WifiOutlined,
} from '@ant-design/icons'
import { Button, Select, Space, Tag, Tooltip } from 'antd'
import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import type { ModelPreset, Project } from '../types'

interface HeaderProps {
  isDark: boolean
  onToggleTheme: () => void
  language: string
  onToggleLanguage: () => void
  backendConnected: boolean
  projects: Project[]
  selectedProjectId: string | null
  onProjectChange: (id: string | null) => void
  onRefreshModels?: () => void
  /** Configured models for the global model selector (enabled + have API keys) */
  configuredModels?: ModelPreset[]
  selectedModelId?: string | null
  onModelChange?: (id: string) => void
}

const Header: React.FC<HeaderProps> = ({
  isDark,
  onToggleTheme,
  language: _language,
  onToggleLanguage,
  backendConnected,
  projects,
  selectedProjectId,
  onProjectChange,
  onRefreshModels,
  configuredModels,
  selectedModelId,
  onModelChange,
}) => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const isHomePage = location.pathname === '/'
  const isModelsPage = location.pathname === '/models'

  // Build grouped options for the global model selector
  const modelOptions = useMemo(() => {
    if (!configuredModels || configuredModels.length === 0) return []
    const grouped = new Map<string, ModelPreset[]>()
    for (const m of configuredModels) {
      const group = grouped.get(m.provider) ?? []
      group.push(m)
      grouped.set(m.provider, group)
    }
    return Array.from(grouped.entries()).map(([provider, models]) => ({
      label: provider,
      options: models.map((m) => ({
        value: m.id,
        label: m.name,
      })),
    }))
  }, [configuredModels])

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 16px',
        height: '48px',
        borderBottom: '1px solid var(--ant-color-border)',
      }}
    >
      <Space>
        {isHomePage ? (
          <>
            <span style={{ fontWeight: 700, fontSize: 16 }}>ALA</span>
            <Tag
              color={backendConnected ? 'success' : 'error'}
              icon={backendConnected ? <WifiOutlined /> : <DisconnectOutlined />}
            >
              {backendConnected ? t('connected') : t('disconnected')}
            </Tag>
            {projects.length > 0 && (
              <Select
                size="small"
                placeholder={t('selectProject')}
                value={selectedProjectId}
                onChange={(v) => onProjectChange(v ?? null)}
                allowClear
                style={{ minWidth: 160 }}
                options={projects.map((p) => ({
                  value: p.id,
                  label: (
                    <Space size={4}>
                      <CodeOutlined />
                      {p.name}
                    </Space>
                  ),
                }))}
              />
            )}
          </>
        ) : (
          <>
            <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => navigate('/')}>
              {t('backToAnalysis')}
            </Button>
            {isModelsPage && onRefreshModels && (
              <Tooltip title={t('refresh')}>
                <Button type="text" icon={<ReloadOutlined />} onClick={onRefreshModels} />
              </Tooltip>
            )}
          </>
        )}
      </Space>
      <Space>
        {/* Global model selector */}
        {isHomePage && modelOptions.length > 0 && onModelChange && (
          <Select
            size="small"
            style={{ minWidth: 140, fontSize: 12 }}
            placeholder={t('switchModel')}
            value={selectedModelId ?? undefined}
            onChange={onModelChange}
            options={modelOptions}
            popupMatchSelectWidth={false}
          />
        )}
        <Tag style={{ fontSize: 11, lineHeight: '16px', padding: '0 4px' }}>v{__APP_VERSION__}</Tag>
        <Tooltip title={t('modelManagement')}>
          <Button
            type="text"
            icon={<AppstoreOutlined />}
            onClick={() => navigate('/models')}
            aria-label={t('modelManagement')}
          />
        </Tooltip>
        <Tooltip title={isDark ? t('switchToLightMode') : t('switchToDarkMode')}>
          <Button
            type="text"
            icon={isDark ? <SunOutlined /> : <MoonOutlined />}
            onClick={onToggleTheme}
            aria-label={isDark ? t('switchToLightMode') : t('switchToDarkMode')}
          />
        </Tooltip>
        <Tooltip title={t('switchLanguage')}>
          <Button
            type="text"
            icon={<GlobalOutlined />}
            onClick={onToggleLanguage}
            aria-label={t('switchLanguage')}
          >
            {t('langCode')}
          </Button>
        </Tooltip>
        <Tooltip title={t('projectSettings')}>
          <Button
            type="text"
            icon={<FolderOutlined />}
            onClick={() => navigate('/projects')}
            aria-label={t('projectSettings')}
          />
        </Tooltip>
        <Tooltip title={t('userGuide')}>
          <Button
            type="text"
            icon={<BookOutlined />}
            onClick={() => navigate('/guide')}
            aria-label={t('userGuide')}
          />
        </Tooltip>
      </Space>
    </div>
  )
}

export default Header
