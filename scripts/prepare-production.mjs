import {productionPolicy} from './production-policy.mjs';
// Deliberately no environment/configuration reads, child processes, network, SQL or output artifact.
if(!productionPolicy.configured||!productionPolicy.releaseEnabled){
 console.error('Production preparation is closed: no reviewed production target or release approval exists.');
 process.exitCode=1;
}else{
 // A future reviewed private-target design is separate work, never an arbitrary CLI/environment override.
 console.error('Production preparation is unavailable.');
 process.exitCode=1;
}
