// Data Model types

export interface ERDataModelVersion {
  id: string;
  dateTime: string;
  description: string;
  number: number;
  model: ERDataModel;
}

export interface ERDataModel {
  id: string;
  name: string;
  containers: ERDataContainerDescriptor[];
}

export interface ERDataContainerDescriptor {
  id: string;
  name: string;
  label?: string;
  description?: string;
  isRoot?: boolean;
  isEnum?: boolean;
  items: ERDataContainerItem[];
}

export interface ERDataContainerItem {
  name: string;
  type: number; // ERFieldType code
  typeDescriptor?: string; // references another container ID
  isTypeDescriptorHost?: boolean;
  label?: string;
  description?: string;
}
