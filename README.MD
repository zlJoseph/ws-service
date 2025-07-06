# WhatsApp Bulk Messaging Service

Este microservicio permite el **envío masivo de mensajes por WhatsApp** utilizando [Baileys](https://github.com/WhiskeySockets/Baileys), una librería cliente de WhatsApp Web no oficial basada en WebSocket.

El servicio permite cargar un archivo `.csv` con los mensajes personalizados y, opcionalmente, un archivo `.zip` que contiene las imágenes a enviar.

## 🚀 Características

- Conexión a WhatsApp mediante **Baileys**.
- Soporte para mensajes personalizados usando templates.
- Envío de imágenes (asociadas a cada número o comunes para todos).
- Autenticación y manejo de sesiones de WhatsApp.
- Validaciones automáticas del CSV y los recursos cargados.

## 📦 Requisitos

- Node.js **>= 20.0.0**
- Redis

## 🗂 Estructura de archivos esperada

### CSV de mensajes

Debe contener al menos una columna con el número (`Numero`) y otras con los datos a reemplazar en el template:

```csv
Numero,Nombre,Producto
519........,Juan,Camiseta
519........,Ana,Pantalón
```

### Template del mensaje

```text
Hola $Nombre, tu producto $Producto ya está listo.
```

### ZIP con imágenes (opcional)

- Si se incluye, las imágenes deben tener el mismo nombre que el número (e.g. `51987654321.jpg`).
- También se puede usar `all.jpg` como imagen común para todos los mensajes.

## 🛠 Uso

Puedes levantar el microservicio y hacer peticiones a través de WebSocket.

## 🤝 Agradecimientos

Este servicio utiliza la biblioteca [Baileys](https://github.com/WhiskeySockets/Baileys), a quienes agradecemos por su gran trabajo en hacer posible la interacción con WhatsApp Web de forma no oficial.

> ⚠️ **Este proyecto no está afiliado ni respaldado por WhatsApp o Meta.** Úsalo bajo tu propia responsabilidad y revisa los [términos de servicio de WhatsApp](https://www.whatsapp.com/legal).

## 📄 Licencia

MIT
