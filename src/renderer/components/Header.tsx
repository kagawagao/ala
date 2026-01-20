import React from 'react';
import { MenuOutlined, BulbOutlined, BulbFilled } from '@ant-design/icons';
import { Button } from 'antd';

interface HeaderProps {
  onToggleDrawer: () => void;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
}

const Header: React.FC<HeaderProps> = ({ onToggleDrawer, theme, onToggleTheme }) => {
  return (
    <header className="bg-dark-hover px-8 py-5 border-b-2 border-accent-blue flex items-center gap-4">
      <Button
        type="text"
        icon={<MenuOutlined />}
        onClick={onToggleDrawer}
        className="text-accent-teal hover:text-accent-blue"
        size="large"
      />
      <div className="flex-1">
        <h1 className="text-accent-teal text-3xl mb-1">🤖 Android Log Analyzer (ALA)</h1>
        <p className="text-text-secondary text-sm">
          Analyze Android logs with time range filtering and AI-powered insights
        </p>
      </div>
      <Button
        type="text"
        icon={theme === 'dark' ? <BulbOutlined /> : <BulbFilled />}
        onClick={onToggleTheme}
        className="text-accent-teal hover:text-accent-blue"
        size="large"
        title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
      />
    </header>
  );
};

export default Header;
