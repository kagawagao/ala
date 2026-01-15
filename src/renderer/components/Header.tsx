import React from 'react';

const Header: React.FC = () => {
  return (
    <header className="bg-dark-hover px-8 py-5 border-b-2 border-accent-blue">
      <h1 className="text-accent-teal text-3xl mb-1">🤖 Android Log Analyzer (ALA)</h1>
      <p className="text-text-secondary text-sm">
        Analyze Android logs with time range filtering and AI-powered insights
      </p>
    </header>
  );
};

export default Header;
