/**
 * Guide utilisateur — documentation en ligne.
 *
 * Affiche le guide utilisateur au format markdown avec une navigation
 * interne et un style cohérent avec l'application.
 */
import { useEffect, useState } from 'react'
import { ArrowLeft, BookOpen } from 'lucide-react'
import { EnTetePage } from '../composants/Coquille'
import { Bouton } from '../composants/ui/base'
import { useNavigate } from 'react-router-dom'

interface MarkdownSection {
  id: string
  title: string
  content: string
  level: number
}

export function GuideUtilisateur() {
  const naviguer = useNavigate()
  const [, setContent] = useState<string>('')
  const [sections, setSections] = useState<MarkdownSection[]>([])
  const [activeSection, setActiveSection] = useState<string>('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Charger le contenu du guide utilisateur
    fetch('/guide-utilisateur.md')
      .then((res) => {
        if (!res.ok) {
          throw new Error('Impossible de charger le guide')
        }
        return res.text()
      })
      .then((text) => {
        setContent(text)
        parseSections(text)
        setLoading(false)
      })
      .catch((err) => {
        console.error('Erreur de chargement du guide:', err)
        setContent('# Erreur de chargement\n\nImpossible de charger le guide utilisateur. Veuillez contacter l\'administrateur.')
        setLoading(false)
      })
  }, [])

  const parseSections = (markdown: string) => {
    const lines = markdown.split('\n')
    const parsedSections: MarkdownSection[] = []
    let currentSection: MarkdownSection | null = null
    let currentContent: string[] = []

    for (const line of lines) {
      const headingMatch = line.match(/^(#{1,6})\s+(.+)$/)
      if (headingMatch) {
        // Sauvegarder la section précédente
        if (currentSection) {
          currentSection.content = currentContent.join('\n')
          parsedSections.push(currentSection)
        }

        // Créer une nouvelle section
        const level = headingMatch[1].length
        const title = headingMatch[2]
        const id = title.toLowerCase().replace(/[^a-z0-9]+/g, '-')

        currentSection = { id, title, content: '', level }
        currentContent = []
      } else if (currentSection) {
        currentContent.push(line)
      }
    }

    // Ajouter la dernière section
    if (currentSection) {
      currentSection.content = currentContent.join('\n')
      parsedSections.push(currentSection)
    }

    setSections(parsedSections)
    if (parsedSections.length > 0) {
      setActiveSection(parsedSections[0].id)
    }
  }

  const renderMarkdown = (text: string): string => {
    // Conversion markdown basique vers HTML
    let html = text

    // Titres
    html = html.replace(/^### (.+)$/gm, '<h3 class="text-lg font-semibold mt-6 mb-2">$1</h3>')
    html = html.replace(/^## (.+)$/gm, '<h2 class="text-xl font-bold mt-8 mb-4">$1</h2>')
    html = html.replace(/^# (.+)$/gm, '<h1 class="text-2xl font-bold mt-6 mb-4">$1</h1>')

    // Gras
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')

    // Italique
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>')

    // Listes
    html = html.replace(/^- (.+)$/gm, '<li class="ml-4">$1</li>')
    html = html.replace(/^(\d+)\. (.+)$/gm, '<li class="ml-4">$2</li>')

    // Paragraphes
    html = html.replace(/\n\n+/g, '</p><p class="my-3">')
    html = `<p class="my-3">${html}</p>`

    // Liens
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="text-primaire underline">$1</a>')

    // Code inline
    html = html.replace(/`([^`]+)`/g, '<code class="bg-attenue px-1 py-0.5 rounded text-sm">$1</code>')

    return html
  }

  const scrollToSection = (id: string) => {
    setActiveSection(id)
    const element = document.getElementById(id)
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' })
    }
  }

  return (
    <div>
      <EnTetePage
        titre="Guide utilisateur"
        description="Documentation complète pour utiliser l'ERP Gestion Fil"
        actions={
          <Bouton variante="contour" onClick={() => naviguer('/')}>
            <ArrowLeft />
            Retour
          </Bouton>
        }
      />

      <div className="grid gap-6 lg:grid-cols-4">
        {/* Navigation latérale */}
        <aside className="lg:col-span-1">
          <div className="sticky top-4 rounded-[var(--radius)] border border-bordure bg-surface p-4">
            <h3 className="mb-3 flex items-center gap-2 font-semibold">
              <BookOpen className="size-4" />
              Sommaire
            </h3>
            <nav className="space-y-1">
              {sections.map((section) => (
                <button
                  key={section.id}
                  onClick={() => scrollToSection(section.id)}
                  className={`block w-full text-left text-sm transition-colors ${
                    activeSection === section.id
                      ? 'font-medium text-primaire'
                      : 'text-attenue-texte hover:text-texte'
                  }`}
                  style={{ paddingLeft: `${(section.level - 1) * 0.5 + 0.5}rem` }}
                >
                  {section.title}
                </button>
              ))}
            </nav>
          </div>
        </aside>

        {/* Contenu principal */}
        <main className="lg:col-span-3">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="text-attenue-texte">Chargement du guide...</div>
            </div>
          ) : (
            <div className="prose prose-slate max-w-none rounded-[var(--radius)] border border-bordure bg-surface p-6">
              {sections.map((section) => (
                <div key={section.id} id={section.id} className="scroll-mt-4">
                  {section.level === 1 && (
                    <h1 className="mb-4 text-2xl font-bold">{section.title}</h1>
                  )}
                  {section.level === 2 && (
                    <h2 className="mb-3 mt-8 text-xl font-bold">{section.title}</h2>
                  )}
                  {section.level === 3 && (
                    <h3 className="mb-2 mt-6 text-lg font-semibold">{section.title}</h3>
                  )}
                  <div
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(section.content) }}
                    className="text-sm leading-relaxed"
                  />
                </div>
              ))}
            </div>
          )}
        </main>
      </div>
    </div>
  )
}