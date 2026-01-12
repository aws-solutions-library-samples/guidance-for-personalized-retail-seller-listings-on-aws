/*
Copyright 2025 Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: LicenseRef-.amazon.com.-AmznSL-1.0
Licensed under the Amazon Software License  http://aws.amazon.com/asl/
*/
import React, { useState } from 'react';
import { Button } from '../ui/button';
import { useAuth } from '../../contexts/AuthContext';

interface ForgotPasswordFormProps {
  onSuccess: () => void;
  onBackToLogin: () => void;
}

export const ForgotPasswordForm: React.FC<ForgotPasswordFormProps> = ({
  onSuccess,
  onBackToLogin,
}) => {
  const [username, setUsername] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [codeSent, setCodeSent] = useState(false);
  
  const { forgotPassword, resetPassword, isLoading } = useAuth();

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    
    if (!username) {
      setError('Please enter your username');
      return;
    }
    
    try {
      const success = await forgotPassword(username);
      if (success) {
        setCodeSent(true);
      } else {
        setError('Failed to send verification code');
      }
    } catch (err) {
      setError('An error occurred');
      console.error('Forgot password error:', err);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    
    if (!code || !newPassword || !confirmPassword) {
      setError('All fields are required');
      return;
    }
    
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    
    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters long');
      return;
    }
    
    try {
      const success = await resetPassword(username, code, newPassword);
      if (success) {
        onSuccess();
      } else {
        setError('Failed to reset password');
      }
    } catch (err) {
      setError('An error occurred');
      console.error('Reset password error:', err);
    }
  };

  if (!codeSent) {
    return (
      <div className="w-full max-w-md p-6 bg-white rounded-lg shadow-md">
        <h2 className="text-2xl font-bold mb-6 text-center">Forgot Password</h2>
        <p className="mb-4 text-gray-600">
          Enter your username and we'll send you a verification code to reset your password.
        </p>
        {error && (
          <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded">
            {error}
          </div>
        )}
        <form onSubmit={handleSendCode}>
          <div className="mb-6">
            <label htmlFor="username" className="block text-sm font-medium text-gray-700 mb-1">
              Username
            </label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={isLoading}
              required
            />
          </div>
          <Button
            type="submit"
            className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-md transition duration-200"
            disabled={isLoading}
          >
            {isLoading ? 'Sending...' : 'Send Verification Code'}
          </Button>
        </form>
        <div className="mt-4 text-center">
          <button
            onClick={onBackToLogin}
            className="text-blue-600 hover:text-blue-800 text-sm"
            type="button"
          >
            Back to Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md p-6 bg-white rounded-lg shadow-md">
      <h2 className="text-2xl font-bold mb-6 text-center">Reset Password</h2>
      <p className="mb-4 text-gray-600">
        Enter the verification code sent to your email and your new password.
      </p>
      {error && (
        <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded">
          {error}
        </div>
      )}
      <form onSubmit={handleResetPassword}>
        <div className="mb-4">
          <label htmlFor="code" className="block text-sm font-medium text-gray-700 mb-1">
            Verification Code
          </label>
          <input
            id="code"
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={isLoading}
            required
          />
        </div>
        <div className="mb-4">
          <label htmlFor="newPassword" className="block text-sm font-medium text-gray-700 mb-1">
            New Password
          </label>
          <input
            id="newPassword"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={isLoading}
            required
          />
        </div>
        <div className="mb-6">
          <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700 mb-1">
            Confirm Password
          </label>
          <input
            id="confirmPassword"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={isLoading}
            required
          />
        </div>
        <Button
          type="submit"
          className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-md transition duration-200"
          disabled={isLoading}
        >
          {isLoading ? 'Resetting...' : 'Reset Password'}
        </Button>
      </form>
      <div className="mt-4 text-center">
        <button
          onClick={onBackToLogin}
          className="text-blue-600 hover:text-blue-800 text-sm"
          type="button"
        >
          Back to Login
        </button>
      </div>
    </div>
  );
};
