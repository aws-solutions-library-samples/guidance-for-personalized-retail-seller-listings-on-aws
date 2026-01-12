/*
Copyright 2025 Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: LicenseRef-.amazon.com.-AmznSL-1.0
Licensed under the Amazon Software License  http://aws.amazon.com/asl/
*/
import { Amplify } from 'aws-amplify';
import { 
  signIn as amplifySignIn, 
  signUp as amplifySignUp, 
  confirmSignUp as amplifyConfirmSignUp, 
  signOut as amplifySignOut, 
  getCurrentUser as amplifyGetCurrentUser, 
  fetchAuthSession,
  resetPassword as amplifyResetPassword
} from 'aws-amplify/auth';

export interface AuthUser {
  username: string;
  email: string;
  attributes: {
    email: string;
    sub: string;
    [key: string]: any;
  };
  signInUserSession: {
    accessToken: {
      jwtToken: string;
    };
  };
}

export interface SignInResult {
  success: boolean;
  user?: AuthUser;
  error?: string;
}

export interface SignUpResult {
  success: boolean;
  userConfirmed: boolean;
  error?: string;
}

export interface ConfirmSignUpResult {
  success: boolean;
  error?: string;
}

export interface ForgotPasswordResult {
  success: boolean;
  error?: string;
}

export interface ResetPasswordResult {
  success: boolean;
  error?: string;
}

/**
 * Service for handling authentication with Amazon Cognito
 */
export const authService = {
  /**
   * Initialize the Auth service with configuration
   */
  configure: (config: {
    userPoolId: string;
    userPoolClientId: string;
  }) => {
    Amplify.configure({
      Auth: {
        Cognito: {
          userPoolId: config.userPoolId,
          userPoolClientId: config.userPoolClientId,
        }
      }
    });
  },

  /**
   * Sign in a user with username and password
   */
  signIn: async (username: string, password: string): Promise<SignInResult> => {
    try {
      const { isSignedIn, nextStep } = await amplifySignIn({ username, password });
      
      if (isSignedIn) {
        const userInfo = await amplifyGetCurrentUser();
        return {
          success: true,
          user: userInfo as unknown as AuthUser,
        };
      } else {
        return {
          success: false,
          error: `Authentication requires additional steps: ${nextStep.signInStep}`,
        };
      }
    } catch (error) {
      console.error('Error signing in:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'An unknown error occurred',
      };
    }
  },

  /**
   * Sign up a new user
   */
  signUp: async (
    username: string,
    password: string,
    email: string
  ): Promise<SignUpResult> => {
    try {
      const { isSignUpComplete } = await amplifySignUp({
        username,
        password,
        options: {
          userAttributes: {
            email,
          },
        },
      });
      
      return {
        success: true,
        userConfirmed: isSignUpComplete,
      };
    } catch (error) {
      console.error('Error signing up:', error);
      return {
        success: false,
        userConfirmed: false,
        error: error instanceof Error ? error.message : 'An unknown error occurred',
      };
    }
  },

  /**
   * Confirm sign up with verification code
   */
  confirmSignUp: async (username: string, code: string): Promise<ConfirmSignUpResult> => {
    try {
      const { isSignUpComplete } = await amplifyConfirmSignUp({
        username,
        confirmationCode: code,
      });
      
      return {
        success: isSignUpComplete,
      };
    } catch (error) {
      console.error('Error confirming sign up:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'An unknown error occurred',
      };
    }
  },

  /**
   * Sign out the current user
   */
  signOut: async (): Promise<boolean> => {
    try {
      await amplifySignOut();
      return true;
    } catch (error) {
      console.error('Error signing out:', error);
      return false;
    }
  },

  /**
   * Get the current authenticated user
   */
  getCurrentUser: async (): Promise<AuthUser | null> => {
    try {
      const userInfo = await amplifyGetCurrentUser();
      return userInfo as unknown as AuthUser;
    } catch (error) {
      return null;
    }
  },

  /**
   * Check if a user is authenticated
   */
  isAuthenticated: async (): Promise<boolean> => {
    try {
      const { tokens } = await fetchAuthSession();
      return tokens !== undefined;
    } catch (error) {
      return false;
    }
  },

  /**
   * Get the current session token
   */
  getToken: async (): Promise<string | null> => {
    try {
      const { tokens } = await fetchAuthSession();
      return tokens?.idToken?.toString() || null;
    } catch (error) {
      return null;
    }
  },

  /**
   * Initiate forgot password flow
   */
  forgotPassword: async (username: string): Promise<ForgotPasswordResult> => {
    try {
      await amplifyResetPassword({ username });
      return {
        success: true,
      };
    } catch (error) {
      console.error('Error initiating forgot password:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'An unknown error occurred',
      };
    }
  },

  /**
   * Complete forgot password flow with new password
   */
  resetPassword: async (
    username: string,
    code: string,
    newPassword: string
  ): Promise<ResetPasswordResult> => {
    try {
      await amplifyResetPassword({
        username,
        options: {
          confirmationCode: code,
          newPassword,
        }
      });
      return {
        success: true,
      };
    } catch (error) {
      console.error('Error resetting password:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'An unknown error occurred',
      };
    }
  },
};
