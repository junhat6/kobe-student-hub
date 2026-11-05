import {productionPolicy} from './production-policy.mjs';
import {loadProductionTarget} from './production-target.mjs';
import {clearProductionArtifact,prepareProductionArtifact} from './production-config.mjs';
// Preparation only. Never starts a subprocess, deployment, resource mutation, SQL, network or login/grant.
try{
 if(process.argv.length!==2||productionPolicy.sampleOnlyPreparationEnabled!==true)throw Error();
 clearProductionArtifact(process.cwd());
 const selection=loadProductionTarget(process.cwd());
 prepareProductionArtifact(process.cwd(),selection.target,selection.preview);
 console.log('Prepared private sample-only production configuration. No deployment or resource change was performed.');
}catch{
 try{clearProductionArtifact(process.cwd())}catch{/* Never follow/delete an unsafe path. */}
 console.error('Production preparation failed. Check the private selection and local source guards.');
 process.exitCode=1;
}
