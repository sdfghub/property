// Menu, service-example tabs, scroll reveal and the contact form. Every page reads fine without it.
const toggle = document.querySelector('.nav-toggle')
if (toggle) {
  const setOpen = (open) => {
    document.body.classList.toggle('menu-open', open)
    toggle.setAttribute('aria-expanded', String(open))
    toggle.setAttribute('aria-label', open ? 'Închide meniul' : 'Deschide meniul')
  }
  toggle.addEventListener('click', () => setOpen(!document.body.classList.contains('menu-open')))
  document.querySelectorAll('.nav-links a').forEach((a) => a.addEventListener('click', () => setOpen(false)))
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setOpen(false) })
}

document.querySelectorAll('[role="tablist"]').forEach((list) => {
  const tabs = [...list.querySelectorAll('[role="tab"]')]
  const select = (tab, focus) => {
    tabs.forEach((t) => {
      const on = t === tab
      t.setAttribute('aria-selected', String(on))
      t.tabIndex = on ? 0 : -1
      document.getElementById(t.getAttribute('aria-controls')).hidden = !on
    })
    if (focus) tab.focus()
  }
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => select(tab))
    tab.addEventListener('keydown', (e) => {
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key]
      if (!step) return
      e.preventDefault()
      select(tabs[(i + step + tabs.length) % tabs.length], true)
    })
  })
})

if ('IntersectionObserver' in window && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const seen = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return
      entry.target.classList.add('in')
      seen.unobserve(entry.target)
    })
  }, { rootMargin: '0px 0px -8% 0px' })
  document.querySelectorAll('.reveal').forEach((el) => {
    if (el.getBoundingClientRect().top > innerHeight) { el.classList.add('pre'); seen.observe(el) }
  })
}

const form = document.querySelector('#validare')
if (form) {
  const role = form.elements.rol
  const size = form.querySelector('#camp-portofoliu')
  const syncSize = () => { size.hidden = !['Administrator', 'Property manager', 'Facility manager'].includes(role.value) }
  const wanted = new URLSearchParams(location.search).get('segment')
  if (wanted && [...role.options].some((o) => o.value === wanted)) role.value = wanted
  role.addEventListener('change', syncSize)
  syncSize()

  form.addEventListener('submit', (e) => {
    e.preventDefault()
    const status = document.querySelector('#stare-formular')
    const to = form.dataset.email
    if (!to) {
      status.textContent = 'Formularul nu este conectat încă. Nu am trimis datele tale.'
      status.className = 'form-status is-warning'
      return
    }
    const d = new FormData(form)
    const body = [`Nume: ${d.get('nume')}`, `E-mail: ${d.get('email')}`, `Rol: ${d.get('rol')}`,
      `Portofoliu: ${d.get('portofoliu') || '-'}`, '', d.get('problema')].join('\n')
    location.href = `mailto:${to}?subject=${encodeURIComponent('Validare VICUSIA')}&body=${encodeURIComponent(body)}`
    status.textContent = 'Ți-am deschis aplicația de e-mail. Solicitarea pleacă după ce apeși Trimite acolo.'
    status.className = 'form-status is-ok'
  })
}
