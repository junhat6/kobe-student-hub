import type {OwnPublicationSummary} from './own-publication-types';
export interface PublicationStopState extends Pick<OwnPublicationSummary,'kind'|'publicId'|'status'|'sourceVersion'> {stopped:boolean}
export interface PublicationStopInput {expectedSourceVersion:number;confirmStop:true}
