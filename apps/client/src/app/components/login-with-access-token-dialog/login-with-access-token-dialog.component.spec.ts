import { MatDialogRef } from '@angular/material/dialog';

import { LoginWithAccessTokenDialogParams } from './interfaces/interfaces';

jest.mock('@ghostfolio/ui/dialog-header', () => ({
  GfDialogHeaderComponent: class {}
}));

jest.mock('@ionic/angular/standalone', () => ({
  IonIcon: class {}
}));

describe('GfLoginWithAccessTokenDialogComponent', () => {
  const { GfLoginWithAccessTokenDialogComponent } = require('./login-with-access-token-dialog.component');

  const createComponent = ({
    accessToken = '',
    adminAccessToken = ''
  }: {
    accessToken?: string;
    adminAccessToken?: string;
  } = {}) => {
    const data: LoginWithAccessTokenDialogParams = {
      accessToken,
      adminAccessToken,
      hasAdminLogin: true,
      hasPermissionToUseAuthGoogle: false,
      hasPermissionToUseAuthOidc: false,
      hasPermissionToUseAuthToken: true,
      title: 'Sign in'
    };

    const dialogRef = {
      close: jest.fn()
    } as unknown as MatDialogRef<GfLoginWithAccessTokenDialogComponent>;

    const settingsStorageService = {
      setSetting: jest.fn()
    } as any;

    return {
      component: new GfLoginWithAccessTokenDialogComponent(
        data,
        dialogRef,
        settingsStorageService
      ),
      dialogRef
    };
  };

  it('fills the security token with the admin token when admin toggle is enabled', () => {
    const { component } = createComponent({
      accessToken: 'manual-token',
      adminAccessToken: 'admin-secret'
    });

    component.onToggleAdminLogin(true);

    expect(component.accessTokenFormControl.value).toBe('admin-secret');
  });

  it('restores previously entered token when admin toggle is disabled', () => {
    const { component } = createComponent({
      accessToken: 'manual-token',
      adminAccessToken: 'admin-secret'
    });

    component.onToggleAdminLogin(true);
    component.onToggleAdminLogin(false);

    expect(component.accessTokenFormControl.value).toBe('manual-token');
  });

  it('closes with access token payload when signing in', () => {
    const { component, dialogRef } = createComponent({
      accessToken: 'manual-token',
      adminAccessToken: 'admin-secret'
    });

    component.onToggleAdminLogin(true);
    component.onLoginWithAccessToken();

    expect(dialogRef.close).toHaveBeenCalledWith({
      accessToken: 'admin-secret'
    });
  });

  it('disables access token reveal controls when admin toggle is enabled', () => {
    const { component } = createComponent({
      accessToken: 'manual-token',
      adminAccessToken: 'admin-secret'
    });

    component.onToggleAdminLogin(true);

    expect(component.showAccessTokenRevealControl).toBe(false);
  });

  it('prevents copy when admin toggle is enabled', () => {
    const { component } = createComponent({
      accessToken: 'manual-token',
      adminAccessToken: 'admin-secret'
    });
    const event = {
      preventDefault: jest.fn()
    } as unknown as ClipboardEvent;

    component.onToggleAdminLogin(true);
    component.onClipboardAction(event);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
  });

  it('allows copy when admin toggle is disabled', () => {
    const { component } = createComponent({
      accessToken: 'manual-token',
      adminAccessToken: 'admin-secret'
    });
    const event = {
      preventDefault: jest.fn()
    } as unknown as ClipboardEvent;

    component.onClipboardAction(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});
