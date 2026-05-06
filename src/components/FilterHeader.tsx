import React from 'react';

type Props = React.HTMLAttributes<HTMLDivElement> & {
  innerRef?: React.Ref<HTMLDivElement>;
};

const defaultStyle: React.CSSProperties = {
  position: 'sticky',
  top: 0,
  zIndex: 1000,
  background: '#0f172a',
  boxShadow: '0 4px 6px rgba(0,0,0,0.3)',
  width: '100%',
  borderRadius: '0 0 12px 12px',
  border: '1px solid rgba(255,255,255,0.05)',
  borderTop: 'none',
  padding: '0.4rem'
};

const FilterHeader = React.forwardRef<HTMLDivElement, Props>(({ children, style, innerRef, ...rest }, ref) => {
  // Prefer forwarded ref if provided via innerRef
  const forwardedRef = (ref as React.Ref<HTMLDivElement>) || innerRef;
  return (
    <div ref={forwardedRef} style={{ ...defaultStyle, ...(style || {}) }} {...rest}>
      {children}
    </div>
  );
});

export default FilterHeader;
