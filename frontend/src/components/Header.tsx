import {
  AppstoreOutlined,
  ArrowLeftOutlined,
  CodeOutlined,
  DisconnectOutlined,
  FolderOutlined,
  GlobalOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  MoonOutlined,
  ReloadOutlined,
  SunOutlined,
  WifiOutlined,
} from '@ant-design/icons'
import { Button, Select, Space, Tag, Tooltip } from 'antd'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import type { Project } from '../types'

interface HeaderProps {
  isDark: boolean
  onToggleTheme: () => void
  language: string
  onToggleLanguage: () => void
  siderCollapsed: boolean
  onToggleSider: () => void
  backendConnected: boolean
  projects: Project[]
  selectedProjectId: string | null
  onProjectChange: (id: string | null) => void
  onRefreshModels?: () => void
}

const Header: React.FC<HeaderProps> = ({
  isDark,
  onToggleTheme,
  language: _language,
  onToggleLanguage,
  siderCollapsed,
  onToggleSider,
  backendConnected,
  projects,
  selectedProjectId,
  onProjectChange,
  onRefreshModels,
}) => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const isHomePage = location.pathname === '/'
  const isModelsPage = location.pathname === '/models'
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
            <Tooltip title={siderCollapsed ? t('showSidebar') : t('hideSidebar')}>
              <Button
                type="text"
                icon={siderCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
                onClick={onToggleSider}
                aria-label={siderCollapsed ? t('showSidebar') : t('hideSidebar')}
              />
            </Tooltip>
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
        <Tag style={{ fontSize: 11, lineHeight: '16px', padding: '0 4px' }}>v{__APP_VERSION__}</Tag>
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
        <Tooltip title={t('modelManagement')}>
          <Button
            type="text"
            icon={<AppstoreOutlined />}
            onClick={() => navigate('/models')}
            aria-label={t('modelManagement')}
          />
        </Tooltip>
      </Space>
    </div>
  )
}

export default Header
