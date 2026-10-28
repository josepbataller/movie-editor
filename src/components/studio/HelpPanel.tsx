import { useEffect, useState } from 'react';
import { useProject } from '@/store/useProject';

// Built-in manual: a side panel organised by what you want to do, with the
// shortcuts that matter for each task. Written for the person who uses this
// tool every day, not as a reference of every option.

interface Section { id: string; title: string; icon: string; body: React.ReactNode }

const K = ({ children }: { children: React.ReactNode }) => <kbd>{children}</kbd>;

const SECTIONS: Section[] = [
  {
    id: 'start', title: 'Empezar', icon: '🚀', body: (
      <>
        <p>La app tiene dos espacios que comparten el mismo proyecto y la misma biblioteca de medios. Cambia con el conmutador <b>🎬 Video | 🎛 Audio Studio</b> de la barra superior.</p>
        <ul>
          <li><b>Video</b>: montar vídeo, títulos, efectos y exportar a MP4.</li>
          <li><b>Audio Studio</b>: componer y grabar música, editar y procesar sonido, y mandar la mezcla al vídeo.</li>
        </ul>
        <p>Guarda con <K>Ctrl+S</K> (archivo <code>.mvproj</code>). Si la app se cierra sin guardar, al abrirla te ofrece recuperar el trabajo (copia automática cada 15 s). Deshacer: <K>Ctrl+Z</K>, rehacer <K>Ctrl+Y</K> — en los dos espacios.</p>
        <p className="tip">Consejo: los archivos de audio y vídeo no se copian al proyecto, se referencian. Si los mueves de carpeta, vuelve a importarlos.</p>
      </>
    ),
  },
  {
    id: 'video', title: 'Montar un vídeo', icon: '🎬', body: (
      <>
        <ol>
          <li><b>Importa</b> (<K>Ctrl+I</K> o arrastra archivos al panel <i>Media</i>). Al soltar un vídeo en la línea de tiempo, su sonido va a una pista de audio enlazada 🔗 (se mueven juntos; <i>Unlink</i> en el inspector para separarlos).</li>
          <li><b>Coloca</b>: arrastra clips para moverlos, tira de los bordes para recortar, <K>S</K> corta en el cursor, <K>Supr</K> borra, <K>Ctrl+D</K> duplica. Las pistas de vídeo superiores se ven encima.</li>
          <li><b>Compón en pantalla</b>: arrastra el clip en la vista previa; rueda = tamaño, <K>Alt</K>+rueda = giro. En el inspector, <i>Screen layout</i> da disposiciones listas (pantalla partida, imagen en imagen, cuartos).</li>
          <li><b>Ajusta</b> en el inspector: color, desenfoque, fundidos, velocidad, volumen. Doble clic en una etiqueta de control la reinicia.</li>
          <li><b>Anima</b> (<i>Animations</i>): efectos por tramos — de un segundo a otro, con subida, meseta y bajada — y presets (giro, zoom, temblor, latido, flash…).</li>
          <li><b>Exporta</b> (<K>Ctrl+E</K>). El motor <i>Fast</i> usa FFmpeg; <i>Precise</i> renderiza fotograma a fotograma igual que la vista previa (se elige solo cuando hay animaciones).</li>
        </ol>
      </>
    ),
  },
  {
    id: 'titles', title: 'Títulos y créditos', icon: '✨', body: (
      <>
        <p><b>Add text</b> (<K>T</K>) o <b>Add credits</b>, y luego <b>✨ Open Title Studio</b> en el inspector: vista previa animada, arrastre del texto, más de 100 plantillas por categorías (intros de estudio, películas y series, fiesta, creadores, retro, moderno, naturaleza, básico) con buscador.</p>
        <p><b>Intros de estudio con tu palabra</b>: en la categoría <i>Studio intros</i> hay recreaciones al estilo Marvel (páginas de cómic dentro de las letras que se vuelven rojo y blanco), Disney (castillo iluminado sobre el lago, estela de polvo de hadas), Marvel Studios (placa plateada con tu palabra recortada en rojo), Pixar (lámpara de escritorio que entra saltando, aplasta la I, se queda en su sitio, te mira y apaga la luz), DreamWorks (luna con nubes), Universal (letras cromadas girando alrededor del planeta), 20th Century (monumento dorado por niveles con focos), Netflix, HBO… Aplica la plantilla y escribe tu nombre en el cuadro de texto.</p>
        <p><b>Fuentes propias</b>: en Style → <b>Font file…</b> cargas un .ttf/.otf (por ejemplo la fuente de fans gratuita <i>Waltograph</i> para el look Disney); queda guardada con el proyecto.</p>
        <p><b>Estilo</b>: relleno (degradado, arcoíris, oro, plata, cromo, fuego, hielo), profundidad 3D, contorno con grosor, brillo neón, fondos animados (disco, confeti, fuegos artificiales, nubes, luna, nieve, lluvia, rejilla synthwave, estática de TV…).</p>
        <p><b>Animación</b>: ~40 entradas (rebote, sello, péndulo, foco, parpadeo neón, letra a letra, palabra a palabra, persianas, pixelado, barrido de luz, foco saltarín, cometa de chispas, cómic…) y ~20 salidas (letras que se dispersan, caída por gravedad, pixelado…). La pestaña <b>Motion FX</b> apila encima zoom, giro, sacudida, desenfoque, brillo, contraste o color en cualquier tramo de tiempo (con rampas), igual que la sección <i>Animations</i> del inspector.</p>
        <p className="tip">Los créditos rodantes y el <i>crawl</i> de Star Wars ocupan todo el clip: alarga el clip para que vayan más despacio. También puedes pedirle al asistente: «pon una intro estilo Marvel con la palabra BATALLER».</p>
      </>
    ),
  },
  {
    id: 'studio', title: 'Audio Studio: lo básico', icon: '🎛', body: (
      <>
        <ul>
          <li><b>+ Track</b>: pista de audio (archivos, grabaciones) o de instrumento (por familias: baterías, teclados, cuerdas, maderas, metales, guitarras, mallets, voces, sintes).</li>
          <li><b>Regla</b>: clic = ir ahí · <K>Shift</K>+arrastrar = región de bucle (🔁 o <K>L</K> la activa). <K>K</K> metrónomo. <K>Espacio</K> reproduce.</li>
          <li><b>Snap</b> y rejilla (compás … 1/64, tresillos). <K>Alt</K> mientras arrastras ignora la rejilla.</li>
          <li><b>Mezclador</b> en cada cabecera: volumen, pan, <b>M</b>ute, <b>S</b>olo, <b>FX</b> (cadena de efectos), ● armar. Clic en el punto de color para cambiar el color de la pista.</li>
          <li><b>Vista</b>: <b>▤ Blocks</b> muestra bloques de color sin detalle (vista general tipo Logic, para muchas pistas); el deslizador de al lado cambia la altura de las pistas. <K>Ctrl</K>+rueda hace zoom temporal.</li>
          <li><b>Clips</b>: doble clic en un patrón abre el editor de notas; doble clic en un clip de audio abre el editor de clip. Esquinas superiores: asas de <b>fade in / out</b> (arrástralas; la curva se elige en el editor de clip).</li>
        </ul>
      </>
    ),
  },
  {
    id: 'typing', title: 'Tocar y escribir notas con el teclado', icon: '⌨️', body: (
      <>
        <p>Selecciona una pista de instrumento (o abre su patrón) y toca:</p>
        <p className="keys"><K>A</K><K>W</K><K>S</K><K>E</K><K>D</K><K>F</K><K>T</K><K>G</K><K>Y</K><K>H</K><K>U</K><K>J</K><K>K</K><K>O</K><K>L</K><K>P</K> = Do, Do#, Re, Re#, Mi, Fa… (teclas blancas en la fila inferior, negras en la superior). <K>Z</K>/<K>X</K> bajan/suben la octava. <K>1</K>–<K>9</K> fuerza.</p>
        <p>El <b>teclado en pantalla</b> bajo el piano roll muestra qué letra toca cada tecla.</p>
        <h4>Escribir notas sin reproducir (entrada por pasos)</h4>
        <ol>
          <li>Abre el patrón (doble clic) y activa <b>⌨ Type notes</b>.</li>
          <li>Pulsa una tecla: escribe la nota en el cursor amarillo. <b>Mantenla pulsada</b> para alargarla (crece al tempo, cuantizada a la rejilla). Varias teclas a la vez = acorde.</li>
          <li>Duración base con <K>[</K> / <K>]</K> (o − / + junto a <i>length</i>). <b>▶</b> deja un silencio, <b>◀</b> retrocede, <b>⟲</b> vuelve al inicio.</li>
        </ol>
        <h4>Grabar notas en vivo</h4>
        <p>Pulsa <b>● Record notes</b> (arma la pista), <K>Espacio</K> y toca: lo que suene queda escrito en el patrón, cuantizado si <i>Snap</i> está activo. Ideal con el bucle activado para ir añadiendo capas.</p>
        <h4>Editar en el piano roll</h4>
        <p>Clic = nota · arrastrar = mover · borde derecho = duración · clic derecho = borrar · <K>Shift</K>+clic = velocidad. Zoom horizontal: <K>Ctrl</K>+rueda; altura de teclas: <K>Ctrl+Shift</K>+rueda (independientes de la vista de pistas).</p>
      </>
    ),
  },
  {
    id: 'record', title: 'Grabar con el micrófono', icon: '🎙', body: (
      <>
        <ol>
          <li>Arma una pista de audio con <b>●</b> en su cabecera (si no hay ninguna, se crea sola).</li>
          <li>Pulsa <b>●</b> en el transporte o <K>R</K>. Suena un compás de metrónomo (cuenta atrás) y empieza a grabar mientras reproduce la mezcla.</li>
          <li>Para con <b>■</b>, <K>Espacio</K> o <K>R</K>. La toma se guarda como WAV junto al proyecto, aparece en <i>Audio files</i> y queda como clip en la pista.</li>
        </ol>
        <p>En el menú <b>▾</b> junto a ●: elegir micrófono, quitar la cuenta atrás, <i>Monitor input</i> para oírte.</p>
        <p><b>Reutilizar una grabación</b>: arrástrala a cualquier pista, o pulsa 🎹 en <i>Audio files</i> para crear un <b>Sampler</b> y tocarla a distintas alturas con el teclado.</p>
        <p className="tip">Si Windows pide permiso para el micrófono, acéptalo; la app lo concede por su parte automáticamente.</p>
      </>
    ),
  },
  {
    id: 'clip', title: 'Editar un sonido: frecuencias, tono, ruido', icon: '🔬', body: (
      <>
        <p>Doble clic en un clip de audio (importado, grabado o traído del vídeo) abre el <b>editor de clip</b>: forma de onda arriba y <b>espectrograma</b> (tiempo × frecuencia) abajo.</p>
        <ul>
          <li><b>Quitar un sonido molesto</b> (zumbido, silbido, tos): arrastra un rectángulo sobre él en el espectrograma y pulsa <b>Remove</b>, o <b>Apply −N dB</b> para atenuarlo. <b>Isolate</b> conserva solo la selección.</li>
          <li><b>Tono</b>: <i>Shift pitch</i> cambia semitonos sin cambiar la duración; <i>Stretch</i> cambia la duración sin cambiar el tono. <i>Speed / pitch</i> (abajo) es el efecto cinta: cambia los dos a la vez y no destruye nada.</li>
          <li><b>Nivel</b>: Normalize, ganancia por región, Loudness (nivel de emisión), Reduce noise (ruido de fondo constante).</li>
          <li><b>Clip effects</b>: pestaña con una cadena de efectos propia del clip (EQ, filtros, reverb, eco, compresor, distorsión…).</li>
        </ul>
        <p>Nada es destructivo: cada proceso crea una versión nueva (WAV) y <b>↩ Revert to original</b> vuelve al audio inicial. <b>▶ Audition</b> escucha la selección.</p>
      </>
    ),
  },
  {
    id: 'fx', title: 'Ecualizar y efectos', icon: '🎚', body: (
      <>
        <p>Botón <b>FX</b> en una pista (o <b>FX</b> junto al volumen máster) → cadena de efectos; la señal pasa de izquierda a derecha. Añade con el desplegable y <b>+ Add</b>.</p>
        <p><b>Equalizer</b>: curva amarilla sobre el espectro en vivo. Arrastra una banda (frecuencia / ganancia), rueda = anchura (Q), doble clic en el vacío = banda nueva. Tipo <i>Notch</i> para matar una frecuencia concreta, <i>High-pass</i> para quitar graves.</p>
        <p>Otros: Filter, Compressor, Reverb, Echo/Delay (sincronizado al tempo, ping-pong), Chorus, Distortion, Bitcrusher. La casilla desactiva un efecto sin borrarlo (compara).</p>
      </>
    ),
  },
  {
    id: 'bridge', title: 'Llevar la música al vídeo y exportar', icon: '🔁', body: (
      <>
        <ul>
          <li><b>Send to video</b> (Audio Studio): renderiza la mezcla y la coloca como clip de audio en la línea de tiempo de vídeo, en el cursor.</li>
          <li><b>Open in Audio Studio</b> (inspector de un clip con sonido, en Video): lleva ese sonido a una pista del estudio para ecualizarlo, limpiarlo o procesarlo, y luego <i>Send to video</i>.</li>
          <li><b>Export audio</b>: WAV, FLAC, MP3, M4A u OGG de la mezcla completa (pistas en mute se omiten; solo se respeta).</li>
        </ul>
      </>
    ),
  },
  {
    id: 'assistant', title: 'Asistente IA (editar hablando)', icon: '🤖', body: (
      <>
        <p>Botón <b>🤖 Assistant</b> (o <K>Ctrl+/</K>): un chat que <b>ejecuta acciones</b> en la app. Pide cosas como «en la pista de voz, de 0:10 a 0:14 quita las frecuencias por encima de 5 kHz», «añade una batería 808 con un ritmo de 4 compases a 95 BPM», «pon un título estilo Star Wars con este texto» o «haz que el clip B sea PiP arriba a la derecha y gire 360° en 2 s».</p>
        <ol>
          <li><b>Configura el modelo</b> en ⚙: elige un preajuste (Anthropic, OpenAI, Gemini, Ollama local, Groq…), pega tu clave y pulsa <i>Test connection</i>. La clave se guarda solo en este ordenador.</li>
          <li>Escribe (Enter envía) o <b>dicta</b> con 🎙 — el dictado necesita un servicio de transcripción compatible con Whisper (OpenAI, Groq…); con Anthropic solo, queda desactivado.</li>
          <li>Cada acción aparece como una tarjeta ✔; todo lo que cambie una petición se deshace con un solo <K>Ctrl+Z</K>.</li>
        </ol>
        <p className="tip">Los chats se guardan y se asocian al proyecto abierto (lista izquierda; <i>all</i> muestra los de todos los proyectos). Sé concreto con tiempos, pistas y frecuencias: el asistente consulta el estado del proyecto antes de actuar.</p>
      </>
    ),
  },
  {
    id: 'shortcuts', title: 'Atajos', icon: '⌨', body: (
      <>
        <h4>Comunes</h4>
        <p><K>Espacio</K> reproducir · <K>Ctrl+Z</K>/<K>Y</K> deshacer/rehacer · <K>Ctrl+S</K> guardar · <K>Ctrl+O</K> abrir · <K>Ctrl+I</K> importar · <K>Ctrl+D</K> duplicar · <K>Supr</K> borrar · <K>S</K> cortar en el cursor · <K>Inicio</K>/<K>Fin</K> · <K>Ctrl</K>+rueda zoom · <K>F1</K> esta ayuda</p>
        <h4>Video</h4>
        <p><K>←</K>/<K>→</K> un fotograma (<K>Shift</K>: 1 s) · <K>T</K> título · <K>M</K> silenciar clip · <K>Ctrl+E</K> exportar</p>
        <h4>Audio Studio</h4>
        <p><K>R</K> grabar · <K>L</K> bucle · <K>K</K> metrónomo · <K>M</K> mute pista · <K>←</K>/<K>→</K> un pulso (<K>Shift</K>: un compás) · <K>Alt</K>+arrastrar sin rejilla · Teclado musical: <K>A</K>…<K>P</K>, <K>Z</K>/<K>X</K> octava, <K>[</K>/<K>]</K> duración, <K>1</K>–<K>9</K> fuerza</p>
      </>
    ),
  },
  {
    id: 'trouble', title: 'Si algo falla', icon: '🛠', body: (
      <>
        <ul>
          <li><b>La app se cerró sola</b>: al abrirla te ofrece recuperar la copia automática. El motivo queda en <code>%APPDATA%\Movie Editor\logs\main.log</code>.</li>
          <li><b>No se oye nada</b>: comprueba mute/solo de pistas, el volumen máster y que el clip no esté en una pista en mute. En Windows, el dispositivo de salida por defecto es el que usa la app.</li>
          <li><b>El micrófono no graba</b>: elige el dispositivo en el menú ▾ junto a ●; revisa el permiso de micrófono de Windows (Configuración → Privacidad).</li>
          <li><b>Faltan archivos</b> al abrir un proyecto: se movieron o renombraron; vuelve a importarlos desde su nueva ubicación.</li>
          <li><b>La exportación de vídeo tarda</b>: el motor <i>Precise</i> va a unas 4–5× el tiempo real; usa <i>Fast</i> si no hay animaciones.</li>
        </ul>
      </>
    ),
  },
];

export default function HelpPanel({ onClose }: { onClose: () => void }) {
  const workspace = useProject((s) => s.workspace);
  const [active, setActive] = useState(workspace === 'audio' ? 'studio' : 'video');
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const visible = q ? SECTIONS.filter((s) => s.title.toLowerCase().includes(q) || textOf(s.body).toLowerCase().includes(q)) : SECTIONS;
  const current = visible.find((s) => s.id === active) ?? visible[0];
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return (
    <div className="help-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <aside className="help-panel">
        <div className="help-head">
          <strong>? Manual de uso</strong>
          <input className="search" placeholder="Buscar… (p. ej. grabar, octava, fade)" value={query} onChange={(e) => setQuery(e.target.value)} />
          <button className="small" onClick={onClose} title="Cerrar (Esc, F1)">✕</button>
        </div>
        <div className="help-body">
          <nav className="help-nav">
            {visible.map((s) => (
              <button key={s.id} className={current?.id === s.id ? 'on' : ''} onClick={() => setActive(s.id)}>{s.icon} {s.title}</button>
            ))}
            {visible.length === 0 && <div className="dim small" style={{ padding: 10 }}>Sin resultados.</div>}
          </nav>
          <article className="help-content">
            {current && <><h3>{current.icon} {current.title}</h3>{current.body}</>}
          </article>
        </div>
      </aside>
    </div>
  );
}

/** Plain text of a React tree (for the search box). */
function textOf(node: React.ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join(' ');
  if (typeof node === 'object' && 'props' in node) return textOf((node as { props: { children?: React.ReactNode } }).props.children);
  return '';
}
