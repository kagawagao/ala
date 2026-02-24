import React from 'react';
import { BulbOutlined, BulbFilled } from '@ant-design/icons';
import { Button } from 'antd';
import { useTranslation } from 'react-i18next';

interface HeaderProps {
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
}

const Header: React.FC<HeaderProps> = ({ theme, onToggleTheme }) => {
  const { t } = useTranslation();

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
