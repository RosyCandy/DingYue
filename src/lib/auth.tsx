import React, { createContext, useContext, useState, ReactNode } from 'react';

export interface User { id: number; email: string; name: string; avatar: string | null; }
interface AuthContextType {
    user: User | null;
    token: string | null;
    login: (token: string, user: User) => void;
    logout: () => void;
    updateUser: (partial: Partial<User>) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const normalizeUser = (raw: string | null): User | null => {
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed.id !== 'number') return null;
        return { id: parsed.id, email: parsed.email, name: parsed.name || '', avatar: parsed.avatar ?? null };
    } catch {
        return null;
    }
};

export function AuthProvider({ children }: { children: ReactNode }) {
    const [token, setToken] = useState<string | null>(() => localStorage.getItem('auth_token'));
    const [user, setUser] = useState<User | null>(() => normalizeUser(localStorage.getItem('auth_user')));

    const persist = (nextToken: string | null, nextUser: User | null) => {
        if (nextToken && nextUser) {
            localStorage.setItem('auth_token', nextToken);
            localStorage.setItem('auth_user', JSON.stringify(nextUser));
        } else {
            localStorage.removeItem('auth_token');
            localStorage.removeItem('auth_user');
        }
        setToken(nextToken);
        setUser(nextUser);
    };

    const login = (nextToken: string, nextUser: User) => {
        persist(nextToken, { ...nextUser, avatar: nextUser.avatar ?? null });
    };

    const logout = () => persist(null, null);

    // 头像 / 昵称等资料变更后调用，保证所有页面（含全局顶栏）即时同步
    const updateUser = (partial: Partial<User>) => {
        setUser((prev) => {
            if (!prev) return prev;
            const next = { ...prev, ...partial };
            localStorage.setItem('auth_user', JSON.stringify(next));
            return next;
        });
    };

    return (
        <AuthContext.Provider value={{ user, token, login, logout, updateUser }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error('useAuth must be used within AuthProvider');
    return ctx;
}
