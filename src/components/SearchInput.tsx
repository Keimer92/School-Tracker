import React from 'react';

interface Props {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  isMobile?: boolean;
}

export default function SearchInput({ value, onChange, placeholder = 'Buscar...', isMobile }: Props) {
  return (
    <div className="search-container" style={{ width: isMobile ? '100%' : '260px', marginRight: '0.4rem', position: 'relative' }}>
      <span className="search-icon-left" style={{ position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', fontSize: '0.95rem' }}>🔍</span>
      <input
        type="text"
        className="search-input search-input-with-icon"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: '100%',
          padding: '0.45rem 2.6rem 0.45rem 2.4rem',
          fontSize: '0.9rem',
          height: '36px',
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '10px',
          color: 'white',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.02)'
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
