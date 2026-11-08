import { publicContactUrl, type PublicServiceInfo } from '../src/shared/service-info';

/** This one optional value is intended for anonymous publication. Other bindings stay private. */
export interface ServiceInfoBindings {
  PUBLIC_CONTACT_URL?: string;
}

export function publicServiceInfo(bindings: ServiceInfoBindings): PublicServiceInfo {
  return { contactUrl: publicContactUrl(bindings.PUBLIC_CONTACT_URL) };
}
