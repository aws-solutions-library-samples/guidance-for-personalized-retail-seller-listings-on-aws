/*
Copyright 2025 Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: LicenseRef-.amazon.com.-AmznSL-1.0
Licensed under the Amazon Software License  http://aws.amazon.com/asl/
*/
import React, { useState } from 'react';
import { LoginForm } from './LoginForm';
import { ForgotPasswordForm } from './ForgotPasswordForm';
import { useAuth } from '../../contexts/AuthContext';

enum AuthView {
  LOGIN,
  FORGOT_PASSWORD,
}

export const AuthContainer: React.FC = () => {
  const [currentView, setCurrentView] = useState<AuthView>(AuthView.LOGIN);
  useAuth();

  const handleAuthSuccess = () => {
    // The authentication state is managed by the AuthContext
    // No need to do anything here as the App component will respond to the auth state change
  };

  const handleForgotPasswordClick = () => {
    setCurrentView(AuthView.FORGOT_PASSWORD);
  };

  const handleBackToLogin = () => {
    setCurrentView(AuthView.LOGIN);
  };

  const renderCurrentView = () => {
    switch (currentView) {
      case AuthView.LOGIN:
        return (
          <LoginForm
            onSuccess={handleAuthSuccess}
            onForgotPassword={handleForgotPasswordClick}
          />
        );
      case AuthView.FORGOT_PASSWORD:
        return (
          <ForgotPasswordForm
            onSuccess={handleBackToLogin}
            onBackToLogin={handleBackToLogin}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="flex justify-center items-center min-h-screen bg-gray-100">
      <div className="w-[80%] max-w-md">
        {renderCurrentView()}
      </div>
    </div>
  );
};
