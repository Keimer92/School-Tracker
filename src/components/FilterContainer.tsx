import React from 'react';

interface FilterContainerProps {
  children: React.ReactNode;
  isMobile?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export function FilterContainer({ children, isMobile = false, className = '', style = {} }: FilterContainerProps) {
  return (
    <div 
      className={`category-card sticky-filters ${className}`}
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 999,
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.2)',
        background: 'rgba(26, 26, 26, 0.8)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        marginBottom: isMobile ? '0.5rem' : '1.5rem',
        width: '100%',
        padding: isMobile ? '0.3rem' : '0.6rem',
        borderRadius: '0 0 12px 12px',
        border: '1px solid rgba(255,255,255,0.05)',
        borderTop: 'none',
        ...style
      }}
    >
      <div 
        className="filters-row"
        style={{
          padding: isMobile ? '0.2rem' : '0.4rem',
          display: 'flex',
          flexWrap: 'wrap',
          gap: isMobile ? '0.3rem' : '0.4rem',
          justifyContent: 'flex-start',
          alignItems: 'flex-end',
          width: '100%'
        }}
      >
        {children}
      </div>
    </div>
  );
}

interface FilterGroupProps {
  children: React.ReactNode;
  label?: string;
  isMobile?: boolean;
  flex?: string;
}

export function FilterGroup({ children, label, isMobile = false, flex }: FilterGroupProps) {
  const defaultFlex = isMobile ? '1 1 40%' : '0 0 auto';
  
  return (
    <div 
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: isMobile ? '0' : '2px',
        flex: flex || defaultFlex
      }}
    >
      {!isMobile && label && (
        <label style={{ fontSize: '0.7rem', color: '#94a3b8', fontWeight: '600' }}>
          {label}
        </label>
      )}
      {children}
    </div>
  );
}

interface FilterSelectProps {
  value: number | string;
  onChange: (value: number | string) => void;
  options: { id: number | string; nombre: string }[];
  placeholder?: string;
  isMobile?: boolean;
  style?: React.CSSProperties;
}

export function FilterSelect({ 
  value, 
  onChange, 
  options, 
  placeholder, 
  isMobile = false,
  style = {}
}: FilterSelectProps) {
  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    onChange(typeof value === 'number' ? Number(val) : val);
  };

  return (
    <select
      className="filter-select"
      style={{
        padding: '0.3rem 0.4rem',
        fontSize: '0.75rem',
        height: '28px',
        width: '100%',
        ...style
      }}
      value={value}
      onChange={handleChange}
    >
      {placeholder && <option value={0}>{placeholder}</option>}
      {options.map(opt => (
        <option key={opt.id} value={opt.id}>
          {opt.nombre}
        </option>
      ))}
    </select>
  );
}

interface FilterActionsProps {
  children: React.ReactNode;
}

export function FilterActions({ children }: FilterActionsProps) {
  return (
    <div style={{ 
      display: 'flex', 
      gap: '0.3rem', 
      flexWrap: 'nowrap', 
      alignItems: 'center',
      justifyContent: 'flex-end',
      width: '100%',
      marginTop: '0.2rem'
    }}>
      {children}
    </div>
  );
}