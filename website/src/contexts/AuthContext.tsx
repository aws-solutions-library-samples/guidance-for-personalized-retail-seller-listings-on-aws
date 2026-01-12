/*
Copyright 2025 Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: LicenseRef-.amazon.com.-AmznSL-1.0
Licensed under the Amazon Software License  http://aws.amazon.com/asl/
*/
import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { authService, AuthUser } from '../services/authService';

interface AuthContextType {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: AuthUser | null;
  signIn: (username: string, password: string) => Promise<boolean>;
  signOut: () => Promise<boolean>;
  forgotPassword: (username: string) => Promise<boolean>;
  resetPassword: (username: string, code: string, newPassword: string) => Promise<boolean>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: ReactNode;
  cognitoConfig: {
    userPoolId: string;
    userPoolClientId: string;
  };
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children, cognitoConfig }) => {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    // Configure Auth service
    authService.configure(cognitoConfig);

    // Check if user is already authenticated
    const checkAuth = async () => {
      try {
        const currentUser = await authService.getCurrentUser();
        if (currentUser) {
          setUser(currentUser);
          setIsAuthenticated(true);
        }
      } catch (error) {
        console.error('Error checking authentication:', error);
      } finally {
        setIsLoading(false);
      }
    };

    checkAuth();
  }, [cognitoConfig]);

  const signIn = async (username: string, password: string): Promise<boolean> => {
    setIsLoading(true);
    try {
      const result = await authService.signIn(username, password);
      if (result.success && result.user) {
        setUser(result.user);
        setIsAuthenticated(true);
        return true;
      }
      return false;
    } catch (error) {
      console.error('Error signing in:', error);
      return false;
    } finally {
      setIsLoading(false);
    }
  };


  const signOut = async (): Promise<boolean> => {
    setIsLoading(true);
    try {
      const result = await authService.signOut();
      if (result) {
        setUser(null);
        setIsAuthenticated(false);
      }
      return result;
    } catch (error) {
      console.error('Error signing out:', error);
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const forgotPassword = async (username: string): Promise<boolean> => {
    setIsLoading(true);
    try {
      const result = await authService.forgotPassword(username);
      return result.success;
    } catch (error) {
      console.error('Error initiating forgot password:', error);
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const resetPassword = async (
    username: string,
    code: string,
    newPassword: string
  ): Promise<boolean> => {
    setIsLoading(true);
    try {
      const result = await authService.resetPassword(username, code, newPassword);
      return result.success;
    } catch (error) {
      console.error('Error resetting password:', error);
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const value = {
    isAuthenticated,
    isLoading,
    user,
    signIn,
    signOut,
    forgotPassword,
    resetPassword,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
