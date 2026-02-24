import React, { useCallback, useMemo } from 'react';
import { BulbOutlined, BulbFilled } from '@ant-design/icons';
import { Button, Dropdown, Select } from 'antd';
import { useTranslation } from 'react-i18next';

interface HeaderProps {
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
}

const Header: React.FC<HeaderProps> = ({ theme, onToggleTheme }) => {
  const { t, i18n } = useTranslation();

  const currentLanguage = useMemo(() => i18n.language || 'en', [i18n.language]);

  const onToggleLanguage = useCallback(() => {
    const newLang = i18n.language === 'en' ? 'zh' : 'en';
    i18n.changeLanguage(newLang);
    localStorage.setItem('language', newLang);
  }, [i18n]);

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
      <Button
        type="text"
        onClick={onToggleLanguage}
        size="large"
        title={currentLanguage === 'en' ? '简体中文' : 'English'}
        style={{ color: theme === 'dark' ? '#4ec9b0' : '#1890ff' }}
      >
        {currentLanguage === 'en' ? '简体中文' : 'English'}
      </Button>
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
