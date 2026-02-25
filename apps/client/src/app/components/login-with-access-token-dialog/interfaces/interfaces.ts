export interface LoginWithAccessTokenDialogParams {
  accessToken: string;
  adminAccessToken?: string;
  hasAdminLogin?: boolean;
  hasPermissionToUseAuthGoogle: boolean;
  hasPermissionToUseAuthOidc: boolean;
  hasPermissionToUseAuthToken: boolean;
  title: string;
}
