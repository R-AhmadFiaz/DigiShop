// Test processes may connect only to loopback; inherited by npm and Node children.
const net=require('node:net');
const original=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...args){
 const normalized=Array.isArray(args[0])?args[0]:args;
 const first=normalized[0];
 const options=typeof first==='object'?first:null;
 const host=options?.host||(typeof normalized[1]==='string'?normalized[1]:'localhost');
 if(!options?.path && !['localhost','127.0.0.1','::1','[::1]'].includes(host)) throw Error('Tests block non-loopback network connections');
 return original.apply(this,args);
};
