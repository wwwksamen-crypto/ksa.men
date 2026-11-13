import React, { Children, cloneElement, isValidElement, useState, type ReactNode } from 'react';
import { SlidersHorizontal, X } from 'lucide-react';
import { useApp } from './lib';
import './action-clarity.css';
export default function CompactFilters({ children, active = false, onClear }: { children: ReactNode; active?: boolean; onClear?: () => void }) {
  const { t, notify } = useApp(); const [open, setOpen] = useState(false);
  const fields = Children.toArray(children), search = fields[0];
  let searchable = search;
  if (isValidElement<{children: ReactNode}>(search)) {
    const contents = Children.toArray(search.props.children);
    const hint = isValidElement<{children: ReactNode}>(contents[0]) ? String(contents[0].props.children || '') : '';
    searchable = cloneElement(search, {}, contents.map(child => isValidElement<{placeholder?: string}>(child) && child.type === 'input' && !child.props.placeholder ? cloneElement(child, { placeholder: hint }) : child));
  }
  return <section className={`compact-filters${active ? ' has-active-filter' : ''}`} aria-label={t('البحث والفلترة', 'Search and filters')}>
    <div className="compact-filters__search">{searchable}
      {fields.length > 1 && <button type="button" className="button button-quiet" aria-expanded={open} onClick={() => { setOpen(!open); notify(open ? t('أغلقت خيارات الفلترة.', 'Filter options closed.') : t('فتحت خيارات الفلترة.', 'Filter options opened.')); }}><SlidersHorizontal size={17}/>{t('فلترة', 'Filters')}{active && <span className="compact-filters__dot"/>}</button>}
      {active && onClear && <button type="button" className="icon-button" aria-label={t('مسح الفلترة', 'Clear filters')} onClick={() => { onClear(); notify(t('أزيلت الفلترة.', 'Filters cleared.')); }}><X size={17}/></button>}
    </div>
    {open && fields.length > 1 && <div className="compact-filters__extra">{fields.slice(1)}</div>}
  </section>;
}
