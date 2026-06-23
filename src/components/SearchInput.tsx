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
      width: isMobile ? '100%' : (expanded ? '260px' : '80px'),
      maxWidth: '40vw',
      marginRight: '0',
      position: 'relative',
      transition: 'width 0.2s ease'
    }}>
      <span className="search-icon-left" style={{ position: 'absolute', left: '6px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', fontSize: '0.9rem', opacity: expanded ? 0.6 : 1 }}>🔍</span>
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
          padding: expanded ? '0.35rem 2rem 0.35rem 2rem' : '0.35rem 0.3rem 0.35rem 1.6rem',
          fontSize: isMobile ? '0.9rem' : '0.85rem',
          height: isMobile ? '34px' : '30px',
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '8px',
          color: 'white',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.02)',
          cursor: expanded ? 'text' : 'pointer',
          transition: 'padding 0.2s ease'
        }}
      />
      {value && (
        <button
          className="search-clear-icon"
          onClick={() => onChange('')}
          style={{ position: 'absolute', right: '4px', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: 'white', cursor: 'pointer', fontSize: '0.85rem', padding: '2px' }}
          aria-label="Limpiar búsqueda"
        >
          ✕
        </button>
      )}
    </div>
  );
}
