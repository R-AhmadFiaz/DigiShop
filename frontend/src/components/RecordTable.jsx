import { Fragment, useId, useRef, useState } from 'react';
import { Empty } from './Common';

// Presentation only: callers supply cells from authoritative records in API order.
export default function RecordTable({label,columns,rows=[],rowKey=row=>row._id??row.eventId,details,onOpen,detailLabel='Details',empty='No records found.',arrowNavigation=false,tableClassName=''}){
  const [expanded,setExpanded]=useState(null),id=useId(),detailOpener=useRef(null);
  const interactive=!!(details||onOpen);
  const cellClass=c=>[c.numeric?'record-number':'',c.kind==='date'||c.key==='date'?'record-date':'',c.kind==='reference'||['reference','invoiceNo','invoice'].includes(c.key)?'record-reference':'',c.kind==='actions'||['actions','open','correct','return','print'].includes(c.key)?'record-actions':'',['action','name','partnerName','accountName','categoryName','product','supplierName'].includes(c.key)?'record-description':''].filter(Boolean).join(' ');
  function open(row,key){if(onOpen)onOpen(row);else{if(details&&expanded!==key)detailOpener.current=document.activeElement;else if(expanded===key)detailOpener.current=null;setExpanded(expanded===key?null:key);}}
  function rowClick(event,row,key){if(event.target.closest('button,a,input,select,textarea,summary,label'))return;open(row,key);}
  function closeDetails(event){if(!details||expanded===null||event.key!=='Escape')return;event.preventDefault();setExpanded(null);const opener=detailOpener.current;detailOpener.current=null;requestAnimationFrame(()=>opener?.focus());}
  return <div className="table-responsive record-register" role="region" aria-label={label} tabIndex={0} onKeyDown={closeDetails}><table className={'table table-sm align-middle record-table '+tableClassName}><caption className="visually-hidden">{label}</caption><thead><tr>{columns.map(c=><th key={c.key} scope="col" className={cellClass(c)} style={c.width?{width:c.width}:undefined}>{c.label}</th>)}{interactive&&<th scope="col" className="record-actions"><span className="visually-hidden">{typeof detailLabel==='function'?'View':detailLabel}</span></th>}</tr></thead><tbody>
    {rows.map((row,index)=>{const key=rowKey(row,index),selected=expanded===key,detailId=id+'-'+index;return <Fragment key={key}><tr data-record-id={String(key)} className={interactive?'record-clickable':undefined} onClick={interactive?e=>rowClick(e,row,key):undefined} tabIndex={interactive?0:undefined} aria-expanded={details?selected:undefined} aria-controls={details?detailId:undefined} onKeyDown={interactive?e=>{if(e.target!==e.currentTarget)return;if(arrowNavigation&&['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();const rows=[...e.currentTarget.parentElement.querySelectorAll(':scope > tr.record-clickable')],current=rows.indexOf(e.currentTarget);rows[Math.max(0,Math.min(rows.length-1,current+(e.key==='ArrowDown'?1:-1)))]?.focus();return;}if(['Enter',' '].includes(e.key)){e.preventDefault();open(row,key,e);}}:undefined}>
      {columns.map(c=>{const value=c.render?c.render(row):row[c.key]??'Unavailable';const placeholder=typeof value==='string'&&value.trim()==='—';return <td key={c.key} className={[cellClass(c),placeholder?'record-placeholder':''].filter(Boolean).join(' ')}>{value}</td>;})}
      {interactive&&<td className="record-actions"><button type="button" className={'btn btn-sm btn-outline-secondary'+(detailLabel==='View'?' record-view-action':'')} aria-expanded={details?selected:undefined} aria-controls={details?detailId:undefined} onClick={()=>open(row,key)}>{typeof detailLabel==='function'?detailLabel(row):detailLabel}</button></td>}
    </tr>{details&&selected&&<tr className="record-detail"><td colSpan={columns.length+1}><div id={detailId}>{details(row)}</div></td></tr>}</Fragment>;})}
    {!rows.length&&<tr><td colSpan={columns.length+(interactive?1:0)}><Empty>{empty}</Empty></td></tr>}
  </tbody></table></div>;
}

export function RecordFacts({items}){
  return <dl className="record-facts">{items.map(([label,value])=><Fragment key={label}><dt>{label}</dt><dd>{value??'Unavailable'}</dd></Fragment>)}</dl>;
}
