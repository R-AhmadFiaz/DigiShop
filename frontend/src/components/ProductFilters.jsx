export default function ProductFilters({search,onSearch,category,onCategory,brand,onBrand,categories=[],brands=[],searchLabel='Search products',categoryLabel='Category filter',brandLabel='Brand filter',visibleSearchLabel,autoFocus=false,disabled=false,searchRef,searchProps={},children}){
  const input=<input ref={searchRef} {...searchProps} className={'form-control '+(!visibleSearchLabel?'product-filter-search':'')} aria-label={searchLabel} placeholder="Name, brand, category or size/model" maxLength={100} value={search} onChange={e=>onSearch(e.target.value)} disabled={disabled} autoFocus={autoFocus}/>;
  return <div className="product-filters d-flex flex-wrap align-items-end gap-2 mb-3">
    {visibleSearchLabel?<label className="form-label m-0 product-filter-search">{visibleSearchLabel}{input}</label>:input}
    <select className="form-select product-filter-choice" aria-label={categoryLabel} value={category} disabled={disabled} onChange={e=>{onCategory(e.target.value);onBrand('');}}><option value="">All categories</option>{categories.map(c=><option key={c._id} value={c._id}>{c.name}</option>)}</select>
    <select className="form-select product-filter-choice" aria-label={brandLabel} value={brand} disabled={disabled} onChange={e=>onBrand(e.target.value)}><option value="">All brands</option>{brands.map(b=><option key={b.value} value={b.value}>{b.label}</option>)}</select>
    {children}
  </div>;
}
