// Local-only standalone project model, separate from article/minutes/report semantics.
import type {Profile} from './types';
export interface ProjectFields {title:string;description:string;githubUrl:string;demoUrl:string}
export interface ProjectDraft extends ProjectFields {id:string;version:number;updatedAt:number}
export type ProjectDraftSummary=Pick<ProjectDraft,'id'|'title'|'version'|'updatedAt'>;
export interface PublicProject extends ProjectFields {id:string;publishedOn:string}
export interface PublicProjectSummary {id:string;title:string;descriptionPreview:string;githubUrl:string;demoUrl:string;publishedOn:string}
export interface PublicProjectReader {project:PublicProject;author:Profile}
export interface PublicAuthorProjects {author:Profile;projects:PublicProjectSummary[]}
export interface ProjectReceipt {publication:({projectId:string;sourceVersion:number}&PublicProjectReader)|null}
