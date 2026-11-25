import type { OwnPublicationSummary } from './own-publication-types';
export interface PublicationStopState extends Pick<
  OwnPublicationSummary,
  'kind' | 'publicId' | 'status' | 'sourceVersion'
> {
  stopped: boolean;
}
interface PublicationStopInput {
  expectedSourceVersion: number;
  confirmStop: true;
}
