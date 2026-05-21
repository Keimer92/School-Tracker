import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

interface ConfirmDialogProps {
    isOpen: boolean;
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    variant?: 'danger' | 'warning' | 'info';
    onConfirm: () => void;
    onCancel: () => void;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
    isOpen,
    title,
    message,
    confirmText = 'Confirmar',
    cancelText = 'Cancelar',
    variant = 'danger',
    onConfirm,
    onCancel,
}) => {
    const [isVisible, setIsVisible] = useState(false);

    useEffect(() => {
        if (isOpen) {
            requestAnimationFrame(() => setIsVisible(true));
        } else {
            setIsVisible(false);
        }
    }, [isOpen]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && isOpen) onCancel();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onCancel]);

    if (!isOpen) return null;

    const variantStyles = {
        danger: {
            icon: '⚠️',
            confirmBg: '#ef4444',
            confirmHover: '#dc2626',
            iconBg: 'rgba(239, 68, 68, 0.1)',
            iconBorder: 'rgba(239, 68, 68, 0.2)',
        },
        warning: {
            icon: '⚡',
            confirmBg: '#f59e0b',
            confirmHover: '#d97706',
            iconBg: 'rgba(245, 158, 11, 0.1)',
            iconBorder: 'rgba(245, 158, 11, 0.2)',
        },
        info: {
            icon: 'ℹ️',
            confirmBg: '#6366f1',
            confirmHover: '#4f46e5',
            iconBg: 'rgba(99, 102, 241, 0.1)',
            iconBorder: 'rgba(99, 102, 241, 0.2)',
        },
    };

    const style = variantStyles[variant];

    const dialog = (
        <div
            style={{
                position: 'fixed',
                inset: 0,
                zIndex: 99999,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '1rem',
            }}
        >
            <div
                onClick={onCancel}
                style={{
                    position: 'absolute',
                    inset: 0,
                    background: 'rgba(0, 0, 0, 0.6)',
                    backdropFilter: 'blur(4px)',
                    opacity: isVisible ? 1 : 0,
                    transition: 'opacity 0.2s ease-out',
                }}
            />
            <div
                style={{
                    position: 'relative',
                    background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.95), rgba(15, 23, 42, 0.98))',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: '20px',
                    padding: '2rem',
                    maxWidth: '420px',
                    width: '100%',
                    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
                    transform: isVisible ? 'scale(1) translateY(0)' : 'scale(0.95) translateY(10px)',
                    opacity: isVisible ? 1 : 0,
                    transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                }}
            >
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
                    <div
                        style={{
                            width: '56px',
                            height: '56px',
                            borderRadius: '50%',
                            background: style.iconBg,
                            border: `1px solid ${style.iconBorder}`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '1.5rem',
                            marginBottom: '1rem',
                        }}
                    >
                        {style.icon}
                    </div>
                    <h3 style={{ margin: '0 0 0.5rem', color: '#f1f5f9', fontSize: '1.25rem', fontWeight: 'bold' }}>
                        {title}
                    </h3>
                    <p style={{ margin: '0 0 1.5rem', color: '#94a3b8', fontSize: '0.9rem', lineHeight: '1.6' }}>
                        {message}
                    </p>
                    <div style={{ display: 'flex', gap: '0.75rem', width: '100%' }}>
                        <button
                            onClick={onCancel}
                            style={{
                                flex: 1,
                                padding: '0.75rem',
                                background: 'rgba(255, 255, 255, 0.05)',
                                border: '1px solid rgba(255, 255, 255, 0.1)',
                                borderRadius: '10px',
                                color: '#e2e8f0',
                                fontWeight: 'bold',
                                fontSize: '0.9rem',
                                cursor: 'pointer',
                                transition: 'all 0.15s ease',
                            }}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                            }}
                        >
                            {cancelText}
                        </button>
                        <button
                            onClick={onConfirm}
                            style={{
                                flex: 1,
                                padding: '0.75rem',
                                background: style.confirmBg,
                                border: 'none',
                                borderRadius: '10px',
                                color: 'white',
                                fontWeight: 'bold',
                                fontSize: '0.9rem',
                                cursor: 'pointer',
                                transition: 'all 0.15s ease',
                            }}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.background = style.confirmHover;
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.background = style.confirmBg;
                            }}
                        >
                            {confirmText}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );

    return createPortal(dialog, document.body);
};
