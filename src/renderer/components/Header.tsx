import React from 'react';
import { MenuOutlined, BulbOutlined, BulbFilled, GlobalOutlined, SettingOutlined } from '@ant-design/icons';
import { Button, Dropdown } from 'antd';
import { useTranslation } from 'react-i18next';

interface HeaderProps {
  onToggleDrawer: () => void;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  onManagePresets: () => void;
}

const Header: React.FC<HeaderProps> = ({ onToggleDrawer, theme, onToggleTheme, onManagePresets }) => {
  const { t, i18n } = useTranslation();

  const handleLanguageChange = (lang: string) => {
    i18n.changeLanguage(lang);
    localStorage.setItem('ala_language', lang);
  };

  const languageMenuItems = [
    {
      key: 'zh',
      label: t('chinese'),
      onClick: () => handleLanguageChange('zh')
    },
    {
      key: 'en',
      label: t('english'),
      onClick: () => handleLanguageChange('en')
    }
  ];

  const presetMenuItems = [
    {
      key: 'manage',
      label: t('managePresets'),
      icon: <SettingOutlined />,
      onClick: onManagePresets
    }
  ];

  return (
    <header style={{
      backgroundColor: theme === 'dark' ? '#1e1e1e' : '#f5f5f5',
      padding: '20px 32px',
      borderBottom: `2px solid ${theme === 'dark' ? '#007acc' : '#1890ff'}`,
      display: 'flex',
      alignItems: 'center',
      gap: '16px'
    }}>
      <div style={{ flex: 1 }}>
        <h1 style={{ 
          color: theme === 'dark' ? '#4ec9b0' : '#1890ff', 
          fontSize: '30px', 
          marginBottom: '4px',
          fontWeight: 600 
        }}>
          🤖 {t('appTitle')}
        </h1>
        <p style={{ 
          color: theme === 'dark' ? '#858585' : '#595959', 
          fontSize: '14px',
          margin: 0 
        }}>
          {t('appDescription')}
        </p>
      </div>
      <Dropdown menu={{ items: presetMenuItems }} placement="bottomRight">
        <Button
          type="text"
          icon={<SettingOutlined />}
          size="large"
          title={t('managePresets')}
          style={{ color: theme === 'dark' ? '#4ec9b0' : '#1890ff' }}
        />
      </Dropdown>
      <Dropdown menu={{ items: languageMenuItems }} placement="bottomRight">
        <Button
          type="text"
          icon={<GlobalOutlined />}
          size="large"
          title={t('switchLanguage')}
          style={{ color: theme === 'dark' ? '#4ec9b0' : '#1890ff' }}
        />
      </Dropdown>
      <Button
        type="text"
        icon={theme === 'dark' ? <BulbOutlined /> : <BulbFilled />}
        onClick={onToggleTheme}
        size="large"
        title={t(theme === 'dark' ? 'switchToLightMode' : 'switchToDarkMode')}
        style={{ color: theme === 'dark' ? '#4ec9b0' : '#1890ff' }}
      />
      <Button
        type="text"
        icon={<MenuOutlined />}
        onClick={onToggleDrawer}
        size="large"
        style={{ color: theme === 'dark' ? '#4ec9b0' : '#1890ff' }}
      />
    </header>
  );
};

export default Header;
