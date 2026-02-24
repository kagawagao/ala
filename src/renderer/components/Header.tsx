import React from 'react';
import { BulbOutlined, BulbFilled } from '@ant-design/icons';
import { Button, Select } from 'antd';
import { useTranslation } from 'react-i18next';

interface HeaderProps {
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
}

const Header: React.FC<HeaderProps> = ({ theme, onToggleTheme }) => {
  const { t, i18n } = useTranslation();

  const handleLanguageChange = (value: string) => {
    i18n.changeLanguage(value);
    localStorage.setItem('language', value);
  };

  return (
    <header
      style={{
        backgroundColor: theme === 'dark' ? '#1e1e1e' : '#f5f5f5',
        padding: '20px 32px',
        borderBottom: `2px solid ${theme === 'dark' ? '#007acc' : '#1890ff'}`,
        display: 'flex',
        alignItems: 'center',
        gap: '16px',
      }}
    >
      <div style={{ flex: 1 }}>
        <h1
          style={{
            color: theme === 'dark' ? '#4ec9b0' : '#1890ff',
            fontSize: '30px',
            marginBottom: '4px',
            fontWeight: 600,
          }}
        >
          🤖 {t('appTitle')}
        </h1>
      </div>
      <Select
        style={{ width: '150px' }}
        value={i18n.language}
        onChange={handleLanguageChange}
        options={[
          { value: 'zh', label: '🌐 ' + t('chinese') },
          { value: 'en', label: '🌐 ' + t('english') },
        ]}
      />
      <Button
        type="text"
        icon={theme === 'dark' ? <BulbOutlined /> : <BulbFilled />}
        onClick={onToggleTheme}
        size="large"
        title={t(theme === 'dark' ? 'switchToLightMode' : 'switchToDarkMode')}
        style={{ color: theme === 'dark' ? '#4ec9b0' : '#1890ff' }}
      />
    </header>
  );
};

export default Header;
