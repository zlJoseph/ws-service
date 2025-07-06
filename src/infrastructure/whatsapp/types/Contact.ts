export interface Contact {
    id: string
    lid?: string
    /** name of the contact, the contact has set on their own on WA */
    name?: string
    notify?: string
    /** I have no idea */
    verifiedName?: string
    imgUrl?: string | null
    status?: string
}