export interface OwnPublicationSummary {
 kind:'article'|'project';publicId:string;title:string;status:'published'|'hidden'|'deleted';publishedAt:number;sourceVersion:number;
}
export interface OwnPublications {publications:OwnPublicationSummary[];moreExists:boolean}
