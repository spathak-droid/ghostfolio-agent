import {
  HttpErrorResponse,
  HttpHandler,
  HttpRequest
} from '@angular/common/http';
import { Router } from '@angular/router';
import { of, throwError } from 'rxjs';

import { HttpResponseInterceptor } from './http-response.interceptor';

jest.mock('@ghostfolio/client/services/token-storage.service', () => ({
  TokenStorageService: class TokenStorageService {
    public signOut = jest.fn();
  }
}));

jest.mock('@ghostfolio/ui/services', () => ({
  DataService: class DataService {
    public fetchInfo = jest.fn().mockReturnValue({ isReadOnlyMode: false });
  }
}));

describe('HttpResponseInterceptor', () => {
  const createInterceptor = ({
    webAuthnEnabled = false
  }: {
    webAuthnEnabled?: boolean;
  } = {}) => {
    const dataService = {
      fetchInfo: jest.fn().mockReturnValue({ isReadOnlyMode: false })
    };
    const router = { navigate: jest.fn() } as unknown as Router;
    const tokenStorageService = {
      signOut: jest.fn()
    };
    const snackBar = {
      open: jest.fn()
    } as any;
    const webAuthnService = {
      isEnabled: jest.fn().mockReturnValue(webAuthnEnabled)
    } as any;

    const interceptor = new HttpResponseInterceptor(
      dataService,
      router,
      tokenStorageService,
      snackBar,
      webAuthnService
    );

    return {
      interceptor,
      router,
      tokenStorageService
    };
  };

  const request = new HttpRequest('GET', '/api/v1/test');

  it('does not sign out on non-session 401 endpoints', () => {
    const { interceptor, tokenStorageService } = createInterceptor();
    const next = {
      handle: () =>
        throwError(
          () =>
            new HttpErrorResponse({
              status: 401,
              url: '/api/v1/portfolio/details'
            })
        )
    } as HttpHandler;

    interceptor.intercept(request, next).subscribe({
      error: () => undefined
    });

    expect(tokenStorageService.signOut).not.toHaveBeenCalled();
  });

  it('signs out on /api/v1/user 401 when WebAuthn is disabled', () => {
    const { interceptor, tokenStorageService, router } = createInterceptor();
    const next = {
      handle: () =>
        throwError(
          () =>
            new HttpErrorResponse({
              status: 401,
              url: '/api/v1/user/me'
            })
        )
    } as HttpHandler;

    interceptor.intercept(request, next).subscribe({
      error: () => undefined
    });

    expect(tokenStorageService.signOut).toHaveBeenCalledTimes(1);
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('navigates to WebAuthn route on /api/v1/auth 401 when WebAuthn is enabled', () => {
    const { interceptor, tokenStorageService, router } = createInterceptor({
      webAuthnEnabled: true
    });
    const next = {
      handle: () =>
        throwError(
          () =>
            new HttpErrorResponse({
              status: 401,
              url: '/api/v1/auth/refresh'
            })
        )
    } as HttpHandler;

    interceptor.intercept(request, next).subscribe({
      error: () => undefined
    });

    expect(router.navigate).toHaveBeenCalledTimes(1);
    expect(tokenStorageService.signOut).not.toHaveBeenCalled();
  });

  it('passes successful responses through untouched', () => {
    const { interceptor, tokenStorageService } = createInterceptor();
    const next = {
      handle: () => of({} as any)
    } as HttpHandler;

    interceptor.intercept(request, next).subscribe();

    expect(tokenStorageService.signOut).not.toHaveBeenCalled();
  });
});
