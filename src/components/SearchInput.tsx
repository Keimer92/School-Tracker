import React, { useState } from 'react';

interface Props {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  isMobile?: boolean;
}

export default function SearchInput({ value, onChange, placeholder = 'Buscar...', isMobile }: Props) {
  const [focused, setFocused] = useState(false);
  const expanded = focused || value.length > 0;
  return (
    <div className="search-container" style={{
      width: isMobile ? '100%' : (expanded ? '260px' : '100px'),
      maxWidth: '40vw',
      marginRight: '0.4rem',
      position: 'relative',
      transition: 'width 0.2s ease',
      flexShrink: expanded ? 1 : 0
    }}>
      <span className="search-icon-left" style={{ position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', fontSize: '0.95rem' }}>🔍</span>
      <input
        type="text"
        className="search-input search-input-with-icon"
        placeholder={expanded ? placeholder : ''}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          width: '100%',
          padding: '0.45rem 2.6rem 0.45rem 2.4rem',
          fontSize: isMobile ? '0.9rem' : '0.92rem',
          height: isMobile ? '36px' : '34px',
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '10px',
          color: 'white',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.02)',
          cursor: expanded ? 'text' : 'pointer'
        }}
      />
      {value && (
        <button
          className="search-clear-icon"
          onClick={() => onChange('')}
          style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: 'white', cursor: 'pointer', fontSize: '0.95rem' }}
          aria-label="Limpiar búsqueda"
        >
          ✕
        </button>
      )}
    </div>
  );
}
